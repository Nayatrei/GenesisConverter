const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');

function buildAsymmetricBubbleSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">
  <path fill="#f2d500" d="M36 18h150c27.6 0 50 22.4 50 50s-22.4 50-50 50H88l-22 18 4-18H36C16.1 118 0 101.9 0 82V68C0 40.4 18.4 18 36 18z"/>
  <rect x="38" y="38" width="20" height="20" rx="4" fill="#111827"/>
</svg>`.trim();
}

async function collectDownloads(page, action, expectedCount = 1) {
    const downloads = [];
    const handler = (download) => downloads.push(download);
    page.on('download', handler);

    try {
        await action();
        await expect.poll(() => downloads.length, {
            timeout: 30_000,
            message: `Expected ${expectedCount} download(s)`
        }).toBe(expectedCount);
        return downloads;
    } finally {
        page.off('download', handler);
    }
}

async function saveDownload(download, testInfo) {
    const targetPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(targetPath);
    return targetPath;
}

function inspectBambuProject(filePath) {
    const script = `
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from math import isfinite

archive = zipfile.ZipFile(sys.argv[1])
names = archive.namelist()
root_model = archive.read('3D/3dmodel.model').decode('utf-8', 'replace')
rels_xml = archive.read('3D/_rels/3dmodel.model.rels').decode('utf-8', 'replace')
plate = json.loads(archive.read('Metadata/plate_1.json').decode('utf-8', 'replace'))
model_settings = archive.read('Metadata/model_settings.config').decode('utf-8', 'replace')
project_settings = json.loads(archive.read('Metadata/project_settings.config').decode('utf-8', 'replace'))

ns = {
    'm': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02',
    'r': 'http://schemas.openxmlformats.org/package/2006/relationships'
}

rels_root = ET.fromstring(rels_xml)
relation_targets = [node.attrib.get('Target') for node in rels_root]
root_model_tree = ET.fromstring(root_model)
root_component_ids = [
    node.attrib.get('objectid')
    for node in root_model_tree.findall('.//m:component', ns)
]

detail_centroid_x = None
if '3D/Objects/object_2.model' in names:
    detail_root = ET.fromstring(archive.read('3D/Objects/object_2.model').decode('utf-8', 'replace'))
    xs = [float(node.attrib['x']) for node in detail_root.findall('.//m:vertex', ns)]
    if xs:
        detail_centroid_x = sum(xs) / len(xs)

mesh_stats = []
assembly_vertices = []
object_resource_ids = {}
for object_name in sorted(name for name in names if name.startswith('3D/Objects/') and name.endswith('.model')):
    object_root = ET.fromstring(archive.read(object_name).decode('utf-8', 'replace'))
    object_resource_ids[object_name] = [
        node.attrib.get('id')
        for node in object_root.findall('./m:resources/m:object', ns)
    ]
    vertices = [
        tuple(float(node.attrib[axis]) for axis in ('x', 'y', 'z'))
        for node in object_root.findall('.//m:vertex', ns)
    ]
    triangles = [
        tuple(int(node.attrib[key]) for key in ('v1', 'v2', 'v3'))
        for node in object_root.findall('.//m:triangle', ns)
    ]
    edges = Counter()
    degenerate_count = 0
    signed_volume = 0.0
    invalid_index_count = 0

    for triangle in triangles:
        if any(index < 0 or index >= len(vertices) for index in triangle):
            invalid_index_count += 1
            continue
        a, b, c = (vertices[index] for index in triangle)
        edges.update([
            tuple(sorted((triangle[0], triangle[1]))),
            tuple(sorted((triangle[1], triangle[2]))),
            tuple(sorted((triangle[2], triangle[0])))
        ])
        ab = tuple(b[axis] - a[axis] for axis in range(3))
        ac = tuple(c[axis] - a[axis] for axis in range(3))
        cross = (
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0]
        )
        if sum(value * value for value in cross) <= 1e-16:
            degenerate_count += 1
        signed_volume += (
            a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0])
        ) / 6.0

    object_bounds = [
        min(vertex[axis] for vertex in vertices) for axis in range(3)
    ] + [
        max(vertex[axis] for vertex in vertices) for axis in range(3)
    ]
    assembly_vertices.extend(vertices)
    mesh_stats.append({
        'name': object_name,
        'vertexCount': len(vertices),
        'triangleCount': len(triangles),
        'invalidIndexCount': invalid_index_count,
        'degenerateCount': degenerate_count,
        'boundaryEdgeCount': sum(count == 1 for count in edges.values()),
        'nonManifoldEdgeCount': sum(count != 2 for count in edges.values()),
        'signedVolume': signed_volume,
        'finiteVertices': all(isfinite(value) for vertex in vertices for value in vertex),
        'bounds': object_bounds
    })

assembly_bounds = [
    min(vertex[axis] for vertex in assembly_vertices) for axis in range(3)
] + [
    max(vertex[axis] for vertex in assembly_vertices) for axis in range(3)
]
model_settings_root = ET.fromstring(model_settings)
part_extruders = [
    node.attrib.get('value')
    for node in model_settings_root.findall('.//part/metadata')
    if node.attrib.get('key') == 'extruder'
]
string_setting_keys = [
    'machine_load_filament_time',
    'machine_unload_filament_time',
    'solid_infill_filament',
    'sparse_infill_filament',
    'support_filament',
    'support_interface_filament',
    'wall_filament'
]

print(json.dumps({
    'names': names,
    'relationTargets': relation_targets,
    'rootComponentIds': root_component_ids,
    'objectResourceIds': object_resource_ids,
    'rootHasBambuNamespace': 'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"' in root_model,
    'rootHas3mfVersion': '<metadata name="BambuStudio:3mfVersion">1</metadata>' in root_model,
    'plate': plate,
    'modelSettings': model_settings,
    'detailCentroidX': detail_centroid_x,
    'meshStats': mesh_stats,
    'assemblyBounds': assembly_bounds,
    'partExtruders': part_extruders,
    'projectSettingTypes': {
        key: type(project_settings.get(key)).__name__
        for key in string_setting_keys
    },
    'filamentSettingsIds': project_settings.get('filament_settings_id', []),
    'printSettingsId': project_settings.get('print_settings_id')
}))
`;

    return JSON.parse(execFileSync('python3', ['-c', script, filePath], { encoding: 'utf8' }));
}

test('3MF serialization uses the same seam tolerance as print validation', async ({ page }) => {
    await page.goto('/3d-obj');

    const result = await page.evaluate(async () => {
        const { validateGeometryBundleForPrint } = await import('/modules/shared/print-validation.js');
        const { buildBambuProjectFiles } = await import('/modules/bambu-project.js?v=seam-tolerance-test');
        const THREERef = window.THREE;
        const points = {
            a: [0, 0, 0],
            b: [10, 0, 0],
            c: [0, 10, 0],
            d: [0, 0, 10]
        };
        const faces = [
            ['a', 'c', 'b'],
            ['a', 'b', 'd'],
            ['a', 'd', 'c'],
            ['b', 'c', 'd']
        ];
        const positions = [];
        faces.forEach((face, faceIndex) => {
            const seamOffset = (faceIndex + 1) * 1e-6;
            face.forEach((key) => {
                const point = points[key];
                positions.push(
                    point[0] + seamOffset,
                    point[1] + seamOffset,
                    point[2] + seamOffset
                );
            });
        });

        const geometry = new THREERef.BufferGeometry();
        geometry.setAttribute('position', new THREERef.Float32BufferAttribute(positions, 3));
        const layer = {
            geometry,
            displayLabel: 'Tolerance Mesh',
            color: { r: 240, g: 200, b: 20 },
            materialIndex: 0
        };
        const validation = validateGeometryBundleForPrint({
            layers: new Map([['tolerance', layer]])
        }, { bedKey: 'x1', margin: 5 });
        const project = buildBambuProjectFiles({
            layers: [layer],
            baseName: 'tolerance_mesh'
        });
        const xml = project.files['3D/Objects/object_1.model'];
        const documentNode = new DOMParser().parseFromString(xml, 'application/xml');
        const vertices = [...documentNode.querySelectorAll('vertex')];
        const triangles = [...documentNode.querySelectorAll('triangle')].map((triangle) => (
            ['v1', 'v2', 'v3'].map((key) => Number.parseInt(triangle.getAttribute(key), 10))
        ));
        const edgeCounts = new Map();
        triangles.forEach(([v1, v2, v3]) => {
            [[v1, v2], [v2, v3], [v3, v1]].forEach(([start, end]) => {
                const edgeKey = start < end ? `${start}|${end}` : `${end}|${start}`;
                edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) || 0) + 1);
            });
        });
        geometry.dispose();

        return {
            validationOk: validation.ok,
            validationBoundaryEdges: validation.layers[0].boundaryEdgeCount,
            serializedVertexCount: vertices.length,
            serializedBoundaryEdges: [...edgeCounts.values()].filter((count) => count === 1).length,
            serializedNonManifoldEdges: [...edgeCounts.values()].filter((count) => count > 2).length
        };
    });

    expect(result).toEqual({
        validationOk: true,
        validationBoundaryEdges: 0,
        serializedVertexCount: 4,
        serializedBoundaryEdges: 0,
        serializedNonManifoldEdges: 0
    });
});

test('3MF serialization rejects triangles that collapse after canonical seam welding', async ({ page }) => {
    await page.goto('/3d-obj');

    const result = await page.evaluate(async () => {
        const { validateGeometryBundleForPrint } = await import('/modules/shared/print-validation.js');
        const { buildBambuProjectFiles } = await import('/modules/bambu-project.js?v=seam-collapse-test');
        const THREERef = window.THREE;
        const a = [10, 10, 0];
        const b = [11, 10, 0];
        const c = [10, 11, 1];
        const d = [12, 10, 0];
        const shift = (point, dy, dz) => [point[0], point[1] + dy, point[2] + dz];
        const faces = [
            [a, c, b],
            [shift(a, 4e-6, 3e-6), shift(b, -4e-6, -3e-6), d],
            [shift(a, 2e-6, -2e-6), shift(d, -2e-6, 2e-6), shift(c, 1e-6, 1e-6)],
            [shift(b, 2e-6, 1e-6), shift(c, -2e-6, -1e-6), shift(d, 1e-6, 2e-6)]
        ];
        const geometry = new THREERef.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREERef.Float32BufferAttribute(faces.flat(2), 3)
        );
        const layer = {
            geometry,
            displayLabel: 'Collapsed Seam',
            color: { r: 240, g: 200, b: 20 },
            materialIndex: 0
        };
        const validation = validateGeometryBundleForPrint({
            layers: new Map([['collapsed', layer]])
        }, { bedKey: 'x1', margin: 0 });
        let error = '';
        try {
            buildBambuProjectFiles({
                layers: [layer],
                baseName: 'collapsed_seam'
            });
        } catch (buildError) {
            error = buildError.message;
        }
        geometry.dispose();
        return { validationOk: validation.ok, error };
    });

    expect(result.validationOk).toBe(true);
    expect(result.error).toContain('3MF serialization failed: Collapsed Seam');
    expect(result.error).toContain('open edge(s)');
});

test('Bambu project export includes native package metadata and preserves handedness', async ({ page }, testInfo) => {
    await page.goto('/3d-obj');

    await expect(page.locator('#svg-bambu-open-btn')).toBeDisabled();

    await page.locator('#file-input').setInputFiles({
        name: 'asymmetric-bubble.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });

    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    await expect(page.locator('#obj-preview-placeholder')).toBeHidden({ timeout: 30_000 });

    const rotationY = await page.evaluate(async () => (await import('/modules/config.js')).OBJ_DEFAULT_ROTATION.y);
    expect(rotationY).toBeLessThan(0);

    const uiPrintSize = await page.locator('#svg-model-size-readout').evaluate((element) => ({
        text: element.textContent,
        width: Number.parseFloat(element.dataset.printWidth),
        depth: Number.parseFloat(element.dataset.printDepth),
        height: Number.parseFloat(element.dataset.printHeight),
        bedFit: element.dataset.bedFit
    }));
    expect(uiPrintSize.text).toMatch(/^\d+\.\d × \d+\.\d × \d+\.\d mm$/);
    expect(uiPrintSize.bedFit).toBe('fits');

    const downloads = await collectDownloads(page, async () => {
        await page.locator('#export-3mf-btn').click();
        await expect(page.locator('#status-text')).toHaveText('Bambu Studio project downloaded. Open the .3mf in Bambu Studio.', { timeout: 30_000 });
    });

    const filePath = await saveDownload(downloads[0], testInfo);
    const project = inspectBambuProject(filePath);

    expect(project.names).toEqual(expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        '3D/3dmodel.model',
        '3D/_rels/3dmodel.model.rels',
        '3D/Objects/object_1.model',
        '3D/Objects/object_2.model',
        'Metadata/project_settings.config',
        'Metadata/model_settings.config',
        'Metadata/slice_info.config',
        'Metadata/plate_1.json',
        'Metadata/filament_sequence.json',
        'Metadata/cut_information.xml',
        'Metadata/plate_1.png',
        'Metadata/plate_1_small.png',
        'Metadata/top_1.png',
        'Metadata/pick_1.png',
        'Metadata/plate_no_light_1.png',
        'Auxiliaries/.thumbnails/thumbnail_3mf.png',
        'Auxiliaries/.thumbnails/thumbnail_middle.png',
        'Auxiliaries/.thumbnails/thumbnail_small.png'
    ]));
    expect(project.rootHasBambuNamespace).toBe(true);
    expect(project.rootHas3mfVersion).toBe(true);
    expect(project.relationTargets).toEqual(expect.arrayContaining([
        '/3D/Objects/object_1.model',
        '/3D/Objects/object_2.model'
    ]));
    expect(project.rootComponentIds).toEqual(['1', '2']);
    expect(project.objectResourceIds).toEqual({
        '3D/Objects/object_1.model': ['1'],
        '3D/Objects/object_2.model': ['2']
    });
    expect(project.plate.bed_type).toBe('textured_plate');
    expect(project.plate.nozzle_diameter).toBeCloseTo(0.4, 5);
    expect(project.plate.filament_colors).toHaveLength(2);
    expect(project.modelSettings).toContain('metadata key="extruder" value="1"');
    expect(project.modelSettings).toContain('metadata key="extruder" value="2"');
    expect(project.partExtruders).toEqual(['1', '2']);
    expect(Object.values(project.projectSettingTypes)).toEqual([
        'str', 'str', 'str', 'str', 'str', 'str', 'str'
    ]);
    expect(project.filamentSettingsIds).toEqual([
        'Generic PLA @BBL X1C',
        'Generic PLA @BBL X1C'
    ]);
    expect(project.printSettingsId).toBe('0.20mm Standard @BBL X1C');

    project.meshStats.forEach((mesh) => {
        expect(mesh.finiteVertices).toBe(true);
        expect(mesh.invalidIndexCount).toBe(0);
        expect(mesh.degenerateCount).toBe(0);
        expect(mesh.boundaryEdgeCount).toBe(0);
        expect(mesh.nonManifoldEdgeCount).toBe(0);
        expect(mesh.signedVolume).toBeGreaterThan(0);
    });

    const [minX, minY, minZ, maxX, maxY, maxZ] = project.assemblyBounds;
    expect(maxX - minX).toBeCloseTo(uiPrintSize.width, 2);
    expect(maxY - minY).toBeCloseTo(uiPrintSize.depth, 2);
    expect(maxZ - minZ).toBeCloseTo(uiPrintSize.height, 2);
    expect((minX + maxX) / 2).toBeCloseTo(128, 4);
    expect((minY + maxY) / 2).toBeCloseTo(128, 4);
    expect(minZ).toBeCloseTo(0, 5);
    expect(minX).toBeGreaterThanOrEqual(5);
    expect(minY).toBeGreaterThanOrEqual(5);
    expect(maxX).toBeLessThanOrEqual(251);
    expect(maxY).toBeLessThanOrEqual(251);
    expect(maxZ).toBeLessThanOrEqual(256);
    expect(project.detailCentroidX).not.toBeNull();
    expect(project.detailCentroidX).toBeLessThan(128);
});

test('default Logo exports a centered, watertight Bambu project at the displayed print size', async ({ page }, testInfo) => {
    await page.goto('/3d-obj');
    await page.locator('.segmented-control-tab[data-tab="logo"]').click();
    await expect(page.locator('#logo-html-status')).toHaveText('Ready', { timeout: 30_000 });
    await expect(page.locator('#logo-export-3mf-btn')).toBeEnabled({ timeout: 30_000 });

    const uiPrintSize = await page.locator('#logo-model-size-readout').evaluate((element) => ({
        text: element.textContent,
        width: Number.parseFloat(element.dataset.printWidth),
        depth: Number.parseFloat(element.dataset.printDepth),
        height: Number.parseFloat(element.dataset.printHeight),
        bedFit: element.dataset.bedFit
    }));
    expect(uiPrintSize.text).toMatch(/^\d+\.\d × \d+\.\d × \d+\.\d mm$/);
    expect(uiPrintSize.bedFit).toBe('fits');

    const downloads = await collectDownloads(page, async () => {
        await page.locator('#logo-export-3mf-btn').click();
        await expect(page.locator('#status-text')).toHaveText(
            'Bambu Studio project downloaded. Open the .3mf in Bambu Studio.',
            { timeout: 30_000 }
        );
    });

    const filePath = await saveDownload(downloads[0], testInfo);
    const project = inspectBambuProject(filePath);
    const [minX, minY, minZ, maxX, maxY, maxZ] = project.assemblyBounds;

    expect(project.meshStats).toHaveLength(2);
    project.meshStats.forEach((mesh) => {
        expect(mesh.finiteVertices).toBe(true);
        expect(mesh.invalidIndexCount).toBe(0);
        expect(mesh.degenerateCount).toBe(0);
        expect(mesh.boundaryEdgeCount).toBe(0);
        expect(mesh.nonManifoldEdgeCount).toBe(0);
        expect(mesh.signedVolume).toBeGreaterThan(0);
    });
    expect(maxX - minX).toBeCloseTo(uiPrintSize.width, 2);
    expect(maxY - minY).toBeCloseTo(uiPrintSize.depth, 2);
    expect(maxZ - minZ).toBeCloseTo(uiPrintSize.height, 2);
    expect((minX + maxX) / 2).toBeCloseTo(128, 4);
    expect((minY + maxY) / 2).toBeCloseTo(128, 4);
    expect(minZ).toBeCloseTo(0, 5);
    expect(project.plate.filament_colors).toHaveLength(2);
});

test('face-down inlay exports complementary front colors with one-color backing', async ({ page }, testInfo) => {
    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'asymmetric-bubble.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });

    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    await page.locator('#obj-face-down-toggle').click();
    await expect(page.locator('#obj-face-down-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-ams-print-style', 'face-down', { timeout: 30_000 });
    await expect(page.locator('#obj-print-orientation-note')).toHaveText('Bed orientation · color face underneath');
    await expect(page.locator('#obj-face-down-toggle')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-base .layer-stack-range')).toHaveText('0.0-2.4mm');
    await expect(page.locator('#layer-stack-list .layer-stack-item:not(.is-base) .layer-stack-range')).toHaveText('0.0-0.6mm');
    await expect(page.locator('#layer-stack-list .layer-stack-item:not(.is-base) .layer-stack-thickness')).toBeDisabled();
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-base .layer-stack-thickness')).toBeDisabled();
    await expect(page.locator('#svg-model-size-readout')).toContainText('× 2.4 mm');

    const downloads = await collectDownloads(page, async () => {
        await page.locator('#export-3mf-btn').click();
        await expect(page.locator('#status-text')).toHaveText(
            'Bambu Studio project downloaded. Open the .3mf in Bambu Studio.',
            { timeout: 30_000 }
        );
    });
    const filePath = await saveDownload(downloads[0], testInfo);
    const project = inspectBambuProject(filePath);

    expect(project.plate.filament_colors).toHaveLength(2);
    expect(project.partExtruders).toEqual(['1', '1', '2']);
    expect(project.meshStats).toHaveLength(3);
    project.meshStats.forEach((mesh) => {
        expect(mesh.finiteVertices).toBe(true);
        expect(mesh.invalidIndexCount).toBe(0);
        expect(mesh.degenerateCount).toBe(0);
        expect(mesh.boundaryEdgeCount).toBe(0);
        expect(mesh.nonManifoldEdgeCount).toBe(0);
        expect(mesh.signedVolume).toBeGreaterThan(0);
    });
    expect(project.assemblyBounds[2]).toBeCloseTo(0, 5);
    expect(project.assemblyBounds[5]).toBeCloseTo(2.4, 1);
    expect(project.meshStats[2].bounds[2]).toBeCloseTo(0, 5);
    expect(project.meshStats[2].bounds[5]).toBeCloseTo(0.6, 1);
});

test('real raster face-down project stays bed-fit and watertight after 3MF serialization', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles(path.join(process.cwd(), 'testImage.png'));

    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 60_000 });
    await page.locator('#obj-face-down-toggle').click();
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute(
        'data-ams-print-style',
        'face-down',
        { timeout: 60_000 }
    );
    await expect(page.locator('#svg-model-size-readout')).toHaveAttribute('data-bed-fit', 'fits');
    const printWidth = Number.parseFloat(
        await page.locator('#svg-model-size-readout').getAttribute('data-print-width')
    );
    expect(printWidth).toBeLessThanOrEqual(246);

    const downloads = await collectDownloads(page, async () => {
        await page.locator('#export-3mf-btn').click();
        await expect.poll(
            () => page.locator('#status-text').textContent(),
            { timeout: 180_000 }
        ).toMatch(/Bambu Studio project downloaded|3D print validation failed:/);
        await expect(page.locator('#status-text')).toContainText('Bambu Studio project downloaded');
    });
    const filePath = await saveDownload(downloads[0], testInfo);
    const project = inspectBambuProject(filePath);

    const filamentCount = project.plate.filament_colors.length;
    expect(filamentCount).toBeGreaterThanOrEqual(2);
    expect(new Set(project.partExtruders)).toEqual(
        new Set(Array.from({ length: filamentCount }, (_, index) => String(index + 1)))
    );
    expect(project.meshStats.length).toBeGreaterThan(3);
    project.meshStats.forEach((mesh) => {
        expect(mesh.finiteVertices).toBe(true);
        expect(mesh.invalidIndexCount).toBe(0);
        expect(mesh.degenerateCount).toBe(0);
        expect(mesh.boundaryEdgeCount).toBe(0);
        expect(mesh.nonManifoldEdgeCount).toBe(0);
        expect(mesh.signedVolume).toBeGreaterThan(0);
        expect(mesh.bounds[2]).toBeGreaterThanOrEqual(-1e-5);
        expect(mesh.bounds[5]).toBeLessThanOrEqual(2.4 + 1e-4);
    });

    const [minX, minY, minZ, maxX, maxY, maxZ] = project.assemblyBounds;
    expect(maxX - minX).toBeLessThanOrEqual(246);
    expect((minX + maxX) / 2).toBeCloseTo(128, 3);
    expect((minY + maxY) / 2).toBeCloseTo(128, 3);
    expect(minZ).toBeCloseTo(0, 5);
    expect(maxZ).toBeCloseTo(2.4, 3);
});

test('Bambu Studio button publishes 3MF and opens the remote project URL', async ({ page, request }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_CALLS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = async (url) => {
            window.__GENESIS_BAMBU_PROTOCOL_CALLS__.push(url);
            return true;
        };
    });

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'asymmetric-bubble.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });

    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    await expect(page.locator('#svg-bambu-open-btn')).toBeEnabled();

    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await page.locator('#svg-bambu-open-btn').click();
    await expect(page.locator('#status-text')).toContainText(
        'Sent asymmetric-bubble_3mm.3mf to Bambu Studio',
        { timeout: 30_000 }
    );

    const protocolCalls = await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__);
    expect(protocolCalls).toHaveLength(1);
    expect(protocolCalls[0]).toMatch(/^bambustudioopen:\/\/https?:\/\//);

    const transferUrl = protocolCalls[0].slice('bambustudioopen://'.length);
    expect(transferUrl).toMatch(/\/api\/bambu-transfer\/[a-f0-9]{48}\/[^/]+\.3mf$/i);

    const transferResponse = await request.get(transferUrl);
    expect(transferResponse.ok()).toBe(true);
    expect(transferResponse.headers()['content-type']).toBe('model/3mf');
    const transferBody = await transferResponse.body();
    expect(transferBody.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(downloads).toHaveLength(0);
});

test('Bambu Studio button downloads a usable backup when direct handoff is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_CALLS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = async (url) => {
            window.__GENESIS_BAMBU_PROTOCOL_CALLS__.push(url);
            return true;
        };
    });
    await page.route('**/api/bambu-transfer**', (route) => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Transfer service unavailable.' })
    }));

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'asymmetric-bubble.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });

    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    const downloads = await collectDownloads(page, async () => {
        await page.locator('#svg-bambu-open-btn').click();
        await expect(page.locator('#status-text')).toContainText(
            'Bambu Studio opened—import the file to continue.',
            { timeout: 30_000 }
        );
    });

    expect(downloads[0].suggestedFilename()).toBe('asymmetric-bubble_3mm.3mf');
    await expect(page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).resolves.toEqual([
        'bambustudioopen://'
    ]);
});

test('Bambu transfer endpoint rejects non-3MF payloads', async ({ request }) => {
    const response = await request.fetch('/api/bambu-transfer?filename=invalid.3mf', {
        method: 'POST',
        headers: {
            'Content-Type': 'model/3mf'
        },
        data: Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('not-a-3mf-package')])
    });

    expect(response.status()).toBe(415);
    await expect(response.json()).resolves.toEqual({
        error: 'Only valid 3MF project files can be transferred.'
    });
});
