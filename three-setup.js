import * as THREE from './vendor/three/build/three.module.js?v=r-013c77c216003608';
import { SVGLoader } from './vendor/three/examples/jsm/loaders/SVGLoader.js?v=r-013c77c216003608';
import { OBJExporter } from './vendor/three/examples/jsm/exporters/OBJExporter.js?v=r-013c77c216003608';
import * as BufferGeometryUtils from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js?v=r-013c77c216003608';

window.THREE = THREE;
window.SVGLoader = SVGLoader;
window.OBJExporter = OBJExporter;
window.BufferGeometryUtils = BufferGeometryUtils;
