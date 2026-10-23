import * as THREE from './vendor/three/build/three.module.js?v=r-b71f5e6f86690950';
import { SVGLoader } from './vendor/three/examples/jsm/loaders/SVGLoader.js?v=r-b71f5e6f86690950';
import { OBJExporter } from './vendor/three/examples/jsm/exporters/OBJExporter.js?v=r-b71f5e6f86690950';
import * as BufferGeometryUtils from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js?v=r-b71f5e6f86690950';

window.THREE = THREE;
window.SVGLoader = SVGLoader;
window.OBJExporter = OBJExporter;
window.BufferGeometryUtils = BufferGeometryUtils;
