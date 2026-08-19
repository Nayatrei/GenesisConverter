import * as THREE from './vendor/three/build/three.module.js?v=r-c511364b448561eb';
import { SVGLoader } from './vendor/three/examples/jsm/loaders/SVGLoader.js?v=r-c511364b448561eb';
import { OBJExporter } from './vendor/three/examples/jsm/exporters/OBJExporter.js?v=r-c511364b448561eb';
import * as BufferGeometryUtils from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js?v=r-c511364b448561eb';

window.THREE = THREE;
window.SVGLoader = SVGLoader;
window.OBJExporter = OBJExporter;
window.BufferGeometryUtils = BufferGeometryUtils;
