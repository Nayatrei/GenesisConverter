const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    await page.goto('/3d-obj');
    await expect.poll(
        () => page.evaluate(() => Boolean(window.THREE)),
        { timeout: 30_000 }
    ).toBe(true);
});

test('print validation accepts a closed model and rejects open mesh geometry', async ({ page }) => {
    const results = await page.evaluate(async () => {
        const { validateGeometryBundleForPrint } = await import('/modules/shared/print-validation.js?v=test');
        const closedGeometry = new window.THREE.BoxGeometry(20, 20, 4);
        closedGeometry.translate(0, 0, 2);
        const openGeometry = new window.THREE.PlaneGeometry(20, 20);

        const createBundle = (geometry) => ({
            layers: new Map([['layer', {
                displayLabel: 'Validation layer',
                geometry
            }]])
        });
        const closed = validateGeometryBundleForPrint(createBundle(closedGeometry), {
            bedKey: 'x1',
            margin: 5
        });
        const open = validateGeometryBundleForPrint(createBundle(openGeometry), {
            bedKey: 'x1',
            margin: 5
        });

        closedGeometry.dispose();
        openGeometry.dispose();
        return {
            closed: { ok: closed.ok, errors: closed.errors },
            open: { ok: open.ok, errors: open.errors }
        };
    });

    expect(results.closed).toEqual({ ok: true, errors: [] });
    expect(results.open.ok).toBe(false);
    expect(results.open.errors.join(' ')).toContain('open mesh edge');
});

// Two same-colour regions that touch at a single diagonal pixel corner weld into
// one shared vertical edge. separatePinchPoints nudges the repeated contour point
// apart at build time; the validator downgrades whatever still slips through to a
// warning, because the shell stays closed and slicers repair it on import.
test('pinched contours are separated at build time and never fail validation', async ({ page }) => {
    const results = await page.evaluate(async () => {
        const { sanitizeGeometryForPrint, separatePinchPoints } = await import('/modules/obj-model-plan.js?v=test-pinch');
        const { validateGeometryBundleForPrint } = await import('/modules/shared/print-validation.js?v=test-pinch');
        const THREE = window.THREE;
        const bufferUtils = window.BufferGeometryUtils || THREE.BufferGeometryUtils;

        const toRing = (pairs) => pairs.map(([x, y]) => ({ x, y }));
        const extrudeRing = (ring) => {
            const shape = new THREE.Shape();
            shape.moveTo(ring[0].x, ring[0].y);
            for (let index = 1; index < ring.length; index++) shape.lineTo(ring[index].x, ring[index].y);
            shape.closePath();
            const geometry = new THREE.ExtrudeGeometry(shape, { depth: 2, curveSegments: 1, bevelEnabled: false });
            geometry.computeVertexNormals();
            return geometry;
        };
        const concatenate = (geometries) => {
            const positions = [];
            geometries.forEach((geometry) => {
                const working = geometry.index ? geometry.toNonIndexed() : geometry;
                const attribute = working.getAttribute('position');
                for (let index = 0; index < attribute.count; index++) {
                    positions.push(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
                }
            });
            const merged = new THREE.BufferGeometry();
            merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            return merged;
        };
        const inspect = (rings, { separate }) => {
            const separation = separatePinchPoints(rings);
            const used = separate ? separation.loops : rings;
            const geometry = sanitizeGeometryForPrint(concatenate(used.map(extrudeRing)), THREE, bufferUtils);
            const validation = validateGeometryBundleForPrint({
                layers: new Map([['layer', { displayLabel: 'L1', geometry }]])
            }, { bedKey: 'x1', margin: 5 });
            geometry?.dispose?.();
            return {
                separatedCount: separation.separatedCount,
                ok: validation.ok,
                errors: validation.errors,
                warnings: validation.warnings,
                nonManifoldEdgeCount: validation.layers[0].nonManifoldEdgeCount,
                boundaryEdgeCount: validation.layers[0].boundaryEdgeCount
            };
        };

        const square = toRing([[0, 0], [10, 0], [10, 10], [0, 10]]);
        const cornerNeighbour = toRing([[10, 10], [20, 10], [20, 20], [10, 20]]);
        const gapNeighbour = toRing([[10.5, 10.5], [20, 10.5], [20, 20], [10.5, 20]]);
        const overlapNeighbour = toRing([[8, 8], [18, 8], [18, 18], [8, 18]]);
        const bowtie = toRing([[0, 0], [10, 0], [10, 10], [20, 10], [20, 20], [10, 20], [10, 10], [0, 10]]);
        const bridge = toRing([
            [0, 0], [10, 0], [10, 4.5], [20, 4.5], [20, 0], [30, 0],
            [30, 10], [20, 10], [20, 5.5], [10, 5.5], [10, 10], [0, 10]
        ]);

        // The validator on its own must not count open edges as non-manifold ones.
        const openPlane = new THREE.PlaneGeometry(20, 20);
        const openValidation = validateGeometryBundleForPrint({
            layers: new Map([['layer', { displayLabel: 'Open', geometry: openPlane }]])
        }, { bedKey: 'x1', margin: 5 });
        openPlane.dispose();

        return {
            single: inspect([square], { separate: true }),
            cornerRaw: inspect([square, cornerNeighbour], { separate: false }),
            cornerSeparated: inspect([square, cornerNeighbour], { separate: true }),
            bowtieSeparated: inspect([bowtie], { separate: true }),
            gap: inspect([square, gapNeighbour], { separate: true }),
            overlap: inspect([square, overlapNeighbour], { separate: true }),
            bridge: inspect([bridge], { separate: true }),
            open: {
                ok: openValidation.ok,
                errors: openValidation.errors,
                nonManifoldEdgeCount: openValidation.layers[0].nonManifoldEdgeCount,
                boundaryEdgeCount: openValidation.layers[0].boundaryEdgeCount
            }
        };
    });

    // Control: a single clean shape is untouched and silent.
    expect(results.single.separatedCount).toBe(0);
    expect(results.single).toMatchObject({ ok: true, errors: [], warnings: [], nonManifoldEdgeCount: 0 });

    // A corner contact used to be a hard error. Untreated it is now only a warning…
    expect(results.cornerRaw.nonManifoldEdgeCount).toBe(1);
    expect(results.cornerRaw.ok).toBe(true);
    expect(results.cornerRaw.errors).toEqual([]);
    expect(results.cornerRaw.warnings.join(' ')).toContain('non-manifold edge');

    // …and with the build-time separation applied the pinch is gone entirely.
    expect(results.cornerSeparated.separatedCount).toBe(1);
    expect(results.cornerSeparated).toMatchObject({
        ok: true,
        errors: [],
        warnings: [],
        nonManifoldEdgeCount: 0,
        boundaryEdgeCount: 0
    });

    // A single self-touching (bowtie) contour is the same defect inside one loop.
    expect(results.bowtieSeparated.separatedCount).toBe(1);
    expect(results.bowtieSeparated).toMatchObject({
        ok: true,
        errors: [],
        warnings: [],
        nonManifoldEdgeCount: 0
    });

    // Controls that must stay no-ops.
    for (const key of ['gap', 'overlap', 'bridge']) {
        expect(results[key].separatedCount, key).toBe(0);
        expect(results[key].ok, key).toBe(true);
        expect(results[key].errors, key).toEqual([]);
        expect(results[key].nonManifoldEdgeCount, key).toBe(0);
        expect(results[key].boundaryEdgeCount, key).toBe(0);
    }

    // Regression: boundary edges are open edges, not non-manifold ones.
    expect(results.open.ok).toBe(false);
    expect(results.open.nonManifoldEdgeCount).toBe(0);
    expect(results.open.boundaryEdgeCount).toBeGreaterThan(0);
    expect(results.open.errors.join(' ')).toContain('open mesh edge');
    expect(results.open.errors.join(' ')).not.toContain('non-manifold');
});

test('print validation rejects models taller than the selected printer', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { validateGeometryBundleForPrint } = await import('/modules/shared/print-validation.js?v=test-height');
        const geometry = new window.THREE.BoxGeometry(20, 20, 200);
        geometry.translate(0, 0, 100);
        const validation = validateGeometryBundleForPrint({
            layers: new Map([['layer', {
                displayLabel: 'Tall model',
                geometry
            }]])
        }, {
            bedKey: 'a1mini',
            margin: 5
        });
        geometry.dispose();
        return {
            ok: validation.ok,
            errors: validation.errors
        };
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('exceeds the Bambu A1 mini height');
});
