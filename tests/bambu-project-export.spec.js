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
    await page.waitForFunction(() => Boolean(window.THREE));

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
    await page.waitForFunction(() => Boolean(window.THREE));

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

    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 60_000 });
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
    // Activation only previews the default preset; the trace runs on Update 3D.
    await expect(page.locator('#logo-html-status')).toHaveText(/Preview only/, { timeout: 30_000 });
    await page.locator('#logo-html-render-btn').click();
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

test('Bambu handoff waits for a second trusted click before launching the remote project URL', async ({ page, request }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_CALLS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_ACTIVATIONS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = (url) => {
            window.__GENESIS_BAMBU_PROTOCOL_CALLS__.push(url);
            window.__GENESIS_BAMBU_PROTOCOL_ACTIVATIONS__.push(
                navigator.userActivation?.isActive === true
            );
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
    await expect(page.locator('#svg-bambu-progress')).toHaveAttribute('data-state', 'ready', {
        timeout: 30_000
    });
    await expect(page.locator('#svg-bambu-progress [data-bambu-progress-stage]')).toHaveText('Transfer ready');
    await expect(page.locator('#svg-bambu-open-btn [data-bambu-button-label]')).toHaveText('Open Bambu Studio');
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).toEqual([]);

    await page.locator('#svg-bambu-open-btn').click();
    await expect(page.locator('#svg-bambu-progress')).toHaveAttribute('data-state', 'warning');
    await expect(page.locator('#svg-bambu-progress [data-bambu-progress-stage]')).toHaveText(
        'Finish in Bambu Studio'
    );
    await expect(page.locator('#status-text')).toContainText('Bambu Studio launch requested for asymmetric-bubble_3mm.3mf');

    const protocolCalls = await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__);
    expect(protocolCalls).toHaveLength(1);
    expect(protocolCalls[0]).toMatch(/^bambustudioopen:\/\/https?:\/\//);
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_ACTIVATIONS__)).toEqual([true]);

    const transferUrl = protocolCalls[0].slice('bambustudioopen://'.length);
    expect(transferUrl).toMatch(/\/api\/bambu-transfer\/[a-f0-9]{48}\/[^/]+\.3mf$/i);

    const transferResponse = await request.get(transferUrl);
    expect(transferResponse.ok()).toBe(true);
    expect(transferResponse.headers()['content-type']).toBe('model/3mf');
    const transferBody = await transferResponse.body();
    expect(transferBody.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(downloads).toHaveLength(0);
});

test('expired prepared Bambu transfer is rejected before the desktop protocol is launched', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_CALLS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = (url) => {
            window.__GENESIS_BAMBU_PROTOCOL_CALLS__.push(url);
            return true;
        };
    });

    await page.route('**/api/bambu-transfer?**', (route) => route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
            expiresAt: new Date(Date.now() - 60_000).toISOString(),
            filename: 'expired-transfer_3mm.3mf',
            url: 'http://127.0.0.1:4173/api/bambu-transfer/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/expired-transfer.3mf'
        })
    }));

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'expired-transfer.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });

    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await page.locator('#svg-bambu-open-btn').click();
    const progress = page.locator('#svg-bambu-progress');
    await expect(progress).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Transfer ready');

    await page.locator('#svg-bambu-open-btn').click();
    await expect(progress).toHaveAttribute('data-state', 'warning');
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Transfer expired');
    await expect(page.locator('#svg-bambu-open-btn [data-bambu-button-label]')).toHaveText('Prepare again');
    await expect(page.locator('#status-text')).toContainText('expired');
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).toEqual([]);
    expect(downloads).toHaveLength(0);
});

test('synthetic Bambu open is rejected until a trusted click supplies user activation', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        // Browser automation can leave Chromium's native transient activation
        // sticky while it drives file controls. Mirror the API from each
        // event's real trust bit so this test isolates the workflow guard.
        window.__GENESIS_TEST_USER_ACTIVATION__ = false;
        Object.defineProperty(navigator, 'userActivation', {
            configurable: true,
            get: () => ({
                hasBeenActive: window.__GENESIS_TEST_USER_ACTIVATION__,
                isActive: window.__GENESIS_TEST_USER_ACTIVATION__
            })
        });
        document.addEventListener('click', (event) => {
            window.__GENESIS_TEST_USER_ACTIVATION__ = event.isTrusted;
        }, true);
        window.__GENESIS_BAMBU_PROTOCOL_CALLS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_ACTIVATIONS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = (url) => {
            window.__GENESIS_BAMBU_PROTOCOL_CALLS__.push(url);
            window.__GENESIS_BAMBU_PROTOCOL_ACTIVATIONS__.push(
                navigator.userActivation?.isActive === true
            );
            return true;
        };
    });

    await page.route('**/api/bambu-transfer?**', (route) => route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            filename: 'trusted-click_3mm.3mf',
            url: 'http://127.0.0.1:4173/api/bambu-transfer/ffffffffffffffffffffffffffffffffffffffffffffffff/trusted-click.3mf'
        })
    }));

    await page.goto('/3d-obj');
    test.skip(
        !await page.evaluate(() => Boolean(navigator.userActivation)),
        'This browser does not expose the User Activation API.'
    );
    await page.locator('#file-input').evaluate((input, source) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([source], 'trusted-click.svg', { type: 'image/svg+xml' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, buildAsymmetricBubbleSvg());
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });

    // Preparing a transfer does not itself need user activation. Starting it
    // synthetically ensures no earlier trusted click can leak activation into
    // the second, protocol-opening event.
    await page.locator('#svg-bambu-open-btn').dispatchEvent('click');
    const progress = page.locator('#svg-bambu-progress');
    await expect(progress).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Transfer ready');
    expect(await page.evaluate(() => navigator.userActivation.isActive)).toBe(false);

    await page.locator('#svg-bambu-open-btn').dispatchEvent('click');
    await expect(progress).toHaveAttribute('data-state', 'ready');
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Direct click required');
    await expect(page.locator('#svg-bambu-open-btn [data-bambu-button-label]')).toHaveText('Open Bambu Studio');
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).toEqual([]);

    await page.locator('#svg-bambu-open-btn').click();
    await expect(progress).toHaveAttribute('data-state', 'warning');
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Finish in Bambu Studio');
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).toHaveLength(1);
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_ACTIVATIONS__)).toEqual([true]);
});

test('Bambu launch without an open signal stays retryable and does not auto-download', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_CALLS__ = [];
        window.__GENESIS_BAMBU_OPEN_RESULT__ = false;
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = (url) => {
            window.__GENESIS_BAMBU_PROTOCOL_CALLS__.push(url);
            return window.__GENESIS_BAMBU_OPEN_RESULT__;
        };
    });

    await page.route('**/api/bambu-transfer?**', (route) => route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            filename: 'retry-launch_3mm.3mf',
            url: 'http://127.0.0.1:4173/api/bambu-transfer/abababababababababababababababababababababababab/retry-launch.3mf'
        })
    }));

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'retry-launch.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });

    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await page.locator('#svg-bambu-open-btn').click();
    const progress = page.locator('#svg-bambu-progress');
    await expect(progress).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });

    await page.locator('#svg-bambu-open-btn').click();
    await expect(progress).toHaveAttribute('data-state', 'warning');
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Bambu Studio did not open');
    await expect(page.locator('#svg-bambu-open-btn [data-bambu-button-label]')).toHaveText(
        'Open Bambu Studio again'
    );
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).toHaveLength(1);
    expect(downloads).toHaveLength(0);

    await page.evaluate(() => {
        window.__GENESIS_BAMBU_OPEN_RESULT__ = true;
    });
    await page.locator('#svg-bambu-open-btn').click();
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Finish in Bambu Studio');
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).toHaveLength(2);
    expect(downloads).toHaveLength(0);
});

test('auto-fit and scheduled preview updates remain immediately sendable', async ({ page }) => {
    test.slow();
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = async () => true;
    });

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'auto-fit-send.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="900" viewBox="0 0 1000 900">'
            + '<rect width="1000" height="900" rx="80" fill="#f2d500"/>'
            + '<circle cx="500" cy="450" r="230" fill="#111827"/>'
            + '</svg>'
        )
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 120_000 });

    const priorRenderCount = Number(
        await page.locator('#obj-preview-canvas').getAttribute('data-full-render-count') || 0
    );
    await page.locator('#obj-scale').evaluate((slider) => {
        slider.value = '200';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // `building` is intentionally transient and may complete between two
    // Playwright polls on a fast worker. The render counter is the durable
    // signal that the scheduled update actually ran.
    await expect.poll(async () => Number(
        await page.locator('#obj-preview-canvas').getAttribute('data-full-render-count') || 0
    ), { timeout: 120_000 }).toBeGreaterThan(priorRenderCount);
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute(
        'data-render-state',
        'ready',
        { timeout: 120_000 }
    );
    await expect(page.locator('#svg-model-size-readout')).toHaveAttribute('data-bed-fit', 'fits');
    expect(Number(await page.locator('#obj-scale').inputValue())).toBeLessThan(200);

    await page.locator('#svg-bambu-open-btn').click();
    await expect(page.locator('#svg-bambu-progress')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await page.locator('#svg-bambu-open-btn').click();
    await expect(page.locator('#svg-bambu-progress [data-bambu-progress-stage]')).toHaveText('Finish in Bambu Studio');
    await expect(page.locator('#status-text')).toContainText('Bambu Studio launch requested for auto-fit-send_3mm.3mf');
});

test('Bambu Studio handoff shows staged progress and ignores repeat clicks', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_CALL_COUNT__ = 0;
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = async () => {
            window.__GENESIS_BAMBU_PROTOCOL_CALL_COUNT__ += 1;
            return true;
        };
    });

    let releaseUpload;
    const uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
    let uploadCount = 0;
    await page.route('**/api/bambu-transfer?**', async (route) => {
        uploadCount += 1;
        await uploadGate;
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                url: 'http://127.0.0.1:4173/api/bambu-transfer/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/progress-test.3mf'
            })
        });
    });

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'progress-test.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });

    await page.evaluate(() => {
        window.__BAMBU_PROGRESS_EVENTS__ = [];
        const progress = document.querySelector('#svg-bambu-progress');
        const bar = progress?.querySelector('[data-bambu-progress-bar]');
        const stage = progress?.querySelector('[data-bambu-progress-stage]');
        const record = () => window.__BAMBU_PROGRESS_EVENTS__.push({
            value: Number(bar?.getAttribute('aria-valuenow') || 0),
            stage: stage?.textContent || '',
            state: progress?.dataset.state || ''
        });
        new MutationObserver(record).observe(progress, {
            subtree: true,
            attributes: true,
            characterData: true,
            childList: true
        });
        record();
    });

    await page.locator('#svg-bambu-open-btn').click();
    await expect(page.locator('#svg-bambu-progress')).toBeVisible();
    await expect(page.locator('#svg-bambu-open-btn')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#svg-bambu-progress [data-bambu-progress-stage]')).toHaveText(
        'Uploading temporary transfer',
        { timeout: 30_000 }
    );

    await page.locator('#svg-bambu-open-btn').dispatchEvent('click');
    expect(uploadCount).toBe(1);
    releaseUpload();

    await expect(page.locator('#svg-bambu-progress')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await expect(page.locator('#svg-bambu-progress [data-bambu-progress-stage]')).toHaveText('Transfer ready');
    await expect(page.locator('#svg-bambu-open-btn')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#svg-bambu-progress [data-bambu-progress-bar]')).toHaveAttribute('aria-valuenow', '100');
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALL_COUNT__)).toBe(0);

    await page.locator('#svg-bambu-open-btn').click();
    await expect(page.locator('#svg-bambu-progress')).toHaveAttribute('data-state', 'warning');
    await expect(page.locator('#svg-bambu-progress [data-bambu-progress-stage]')).toHaveText('Finish in Bambu Studio');
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALL_COUNT__)).toBe(1);

    const events = await page.evaluate(() => window.__BAMBU_PROGRESS_EVENTS__);
    const values = events.map((event) => event.value);
    expect(values.length).toBeGreaterThan(5);
    expect(values).toEqual([...values].sort((left, right) => left - right));
    const stages = events.map((event) => event.stage);
    expect(stages).toContain('Preparing model');
    expect(stages).toContain('Uploading temporary transfer');
    expect(stages).toContain('Transfer ready');
    expect(stages).toContain('Opening Bambu Studio');
    expect(stages).toContain('Finish in Bambu Studio');
    expect(uploadCount).toBe(1);
});

test('changing the model cancels an active Bambu transfer before launch or fallback', async ({ page }) => {
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

    let releaseUpload;
    const uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
    let uploadCount = 0;
    await page.route('**/api/bambu-transfer?**', async (route) => {
        uploadCount += 1;
        await uploadGate;
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                url: 'http://127.0.0.1:4173/api/bambu-transfer/cccccccccccccccccccccccccccccccccccccccccccccccc/cancel-test.3mf'
            })
        }).catch(() => {});
    });

    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'cancel-test.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });

    await page.locator('#svg-bambu-open-btn').click();
    await expect(page.locator('#svg-bambu-progress [data-bambu-progress-stage]')).toHaveText(
        'Uploading temporary transfer',
        { timeout: 30_000 }
    );
    expect(uploadCount).toBe(1);

    const priorRenderCount = Number(
        await page.locator('#obj-preview-canvas').getAttribute('data-full-render-count') || 0
    );
    await page.locator('#obj-scale').evaluate((slider) => {
        slider.value = String(Math.max(Number(slider.min) || 1, Number(slider.value) - 1));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.locator('#svg-bambu-progress')).toBeHidden();
    await expect(page.locator('#svg-bambu-progress')).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('#svg-bambu-open-btn')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(async () => Number(
        await page.locator('#obj-preview-canvas').getAttribute('data-full-render-count') || 0
    )).toBeGreaterThan(priorRenderCount);

    releaseUpload();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).toEqual([]);
    expect(downloads).toHaveLength(0);
    await expect(page.locator('#status-text')).not.toContainText('Sent cancel-test');
    expect(uploadCount).toBe(1);
});

test('Bambu send stays visibly cancelling until a non-abortable launch step unwinds', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_CALLS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_RELEASE__ = null;
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = (url) => {
            window.__GENESIS_BAMBU_PROTOCOL_CALLS__.push(url);
            return new Promise((resolve) => {
                window.__GENESIS_BAMBU_PROTOCOL_RELEASE__ = resolve;
            });
        };
    });

    let uploadCount = 0;
    await page.route('**/api/bambu-transfer?**', async (route) => {
        uploadCount += 1;
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                url: 'http://127.0.0.1:4173/api/bambu-transfer/dddddddddddddddddddddddddddddddddddddddddddddddd/cancelling-test.3mf'
            })
        });
    });

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'cancelling-test.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    await page.locator('#svg-bambu-open-btn').click();
    await expect(page.locator('#svg-bambu-progress')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).toEqual([]);
    await page.locator('#svg-bambu-open-btn').click();
    await expect.poll(() => page.evaluate(() => (
        typeof window.__GENESIS_BAMBU_PROTOCOL_RELEASE__ === 'function'
    ))).toBe(true);
    expect(uploadCount).toBe(1);

    await page.locator('#obj-scale').evaluate((slider) => {
        slider.value = String(Math.max(Number(slider.min) || 1, Number(slider.value) - 1));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const progress = page.locator('#svg-bambu-progress');
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Cancelling previous send');
    await expect(page.locator('#svg-bambu-open-btn')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#svg-bambu-open-btn')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('#svg-bambu-open-btn').dispatchEvent('click');
    expect(uploadCount).toBe(1);

    await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_RELEASE__(true));
    await expect(progress).toBeHidden();
    await expect(progress).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('#svg-bambu-open-btn')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#status-text')).not.toContainText('Sent cancelling-test');

    await page.evaluate(() => {
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = async (url) => {
            window.__GENESIS_BAMBU_PROTOCOL_CALLS__.push(url);
            return true;
        };
    });
    await page.locator('#svg-bambu-open-btn').click();
    await expect(progress).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await page.locator('#svg-bambu-open-btn').click();
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Finish in Bambu Studio');
    expect(uploadCount).toBe(2);
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__.length)).toBe(2);
});

test('Bambu send reports an error, releases busy state, retries, and resets for a new model', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = async () => true;
    });

    let uploadCount = 0;
    await page.route('**/api/bambu-transfer?**', async (route) => {
        uploadCount += 1;
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                url: 'http://127.0.0.1:4173/api/bambu-transfer/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/retry-test.3mf'
            })
        });
    });

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'retry-test.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });

    const originalScale = await page.locator('#obj-scale').inputValue();
    await page.locator('#obj-scale').evaluate((slider) => {
        slider.value = String(Number(slider.value) + 1);
    });
    await page.locator('#svg-bambu-open-btn').click();

    const progress = page.locator('#svg-bambu-progress');
    const stage = progress.locator('[data-bambu-progress-stage]');
    await expect(progress).toHaveAttribute('data-state', 'error');
    await expect(stage).toHaveText('Preview still updating');
    await expect(stage).toHaveAttribute('role', 'alert');
    await expect(stage).toHaveAttribute('aria-live', 'assertive');
    await expect(page.locator('#svg-bambu-open-btn')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#svg-bambu-open-btn')).not.toHaveAttribute('aria-disabled', 'true');
    expect(uploadCount).toBe(0);

    await page.locator('#obj-scale').evaluate((slider, value) => {
        slider.value = value;
    }, originalScale);
    await page.locator('#svg-bambu-open-btn').click();
    await expect(progress).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await expect(progress.locator('[data-bambu-progress-bar]')).toHaveAttribute('aria-valuenow', '100');
    expect(uploadCount).toBe(1);
    await page.locator('#svg-bambu-open-btn').click();
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Finish in Bambu Studio');
    await expect(page.locator('#status-text')).toContainText('Bambu Studio launch requested for retry-test_3mm.3mf');

    const priorRenderCount = Number(
        await page.locator('#obj-preview-canvas').getAttribute('data-full-render-count') || 0
    );
    await page.locator('#obj-scale').evaluate((slider) => {
        slider.value = String(Math.max(Number(slider.min) || 1, Number(slider.value) - 1));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(async () => Number(
        await page.locator('#obj-preview-canvas').getAttribute('data-full-render-count') || 0
    )).toBeGreaterThan(priorRenderCount);
    await expect(progress).toBeHidden();
    await expect(progress).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('#status-text')).not.toContainText('launch requested for retry-test');

    await page.locator('#file-input').setInputFiles({
        name: 'next-model.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg().replace('#f2d500', '#22c55e'))
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    await expect(progress).toBeHidden();
    await expect(progress).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('#svg-bambu-open-meta')).toHaveText(
        'Build a 10-minute transfer, then open Bambu Studio'
    );
});

test('Bambu send paint wait falls back when animation frames are suspended', async ({ page }) => {
    await page.goto('/3d-obj');
    const elapsed = await page.evaluate(async () => {
        const progressModule = await import('/modules/shared/bambu-send-progress.js?v=paint-timeout-test');
        const originalRequest = globalThis.requestAnimationFrame;
        const originalCancel = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = () => 42;
        globalThis.cancelAnimationFrame = () => {};
        const startedAt = performance.now();
        try {
            await progressModule.waitForBrowserPaint({ timeoutMs: 25 });
            return performance.now() - startedAt;
        } finally {
            globalThis.requestAnimationFrame = originalRequest;
            globalThis.cancelAnimationFrame = originalCancel;
        }
    });
    expect(elapsed).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(500);
});

test('static host fallback downloads once, then opens bare Bambu Studio on a second trusted click', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_CALLS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_ACTIVATIONS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = (url) => {
            window.__GENESIS_BAMBU_PROTOCOL_CALLS__.push(url);
            window.__GENESIS_BAMBU_PROTOCOL_ACTIVATIONS__.push(
                navigator.userActivation?.isActive === true
            );
            return true;
        };
    });
    await page.route('**/health', (route) => route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'Not found'
    }));
    let transferPostCount = 0;
    await page.route('**/api/bambu-transfer?**', (route) => {
        transferPostCount += 1;
        return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Transfer service unavailable.' })
        });
    });

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'asymmetric-bubble.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildAsymmetricBubbleSvg())
    });

    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await Promise.all([
        page.waitForEvent('download'),
        page.locator('#svg-bambu-open-btn').click()
    ]);
    await expect(page.locator('#status-text')).toContainText('downloaded to Downloads', {
        timeout: 30_000
    });

    expect(downloads[0].suggestedFilename()).toBe('asymmetric-bubble_3mm.3mf');
    const progress = page.locator('#svg-bambu-progress');
    await expect(progress).toHaveAttribute('data-state', 'ready');
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('3MF downloaded');
    await expect(page.locator('#svg-bambu-open-btn [data-bambu-button-label]')).toHaveText(
        'Open Bambu Studio'
    );
    await expect(page.locator('#svg-bambu-open-btn')).toHaveAttribute('aria-busy', 'false');
    expect(transferPostCount).toBe(0);
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).toEqual([]);

    await page.locator('#svg-bambu-open-btn').click();
    await expect(progress).toHaveAttribute('data-state', 'warning');
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('Import from Downloads');
    await expect(page.locator('#status-text')).toContainText(
        'Import asymmetric-bubble_3mm.3mf from Downloads'
    );
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_CALLS__)).toEqual([
        'bambustudioopen://'
    ]);
    expect(await page.evaluate(() => window.__GENESIS_BAMBU_PROTOCOL_ACTIVATIONS__)).toEqual([true]);
    expect(downloads).toHaveLength(1);
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
