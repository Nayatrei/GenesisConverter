import * as THREE from './vendor/three/build/three.module.js?v=r-7f197cb5dd025a87';
import { SVGLoader } from './vendor/three/examples/jsm/loaders/SVGLoader.js?v=r-7f197cb5dd025a87';
import { OBJExporter } from './vendor/three/examples/jsm/exporters/OBJExporter.js?v=r-7f197cb5dd025a87';
import * as BufferGeometryUtils from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js?v=r-7f197cb5dd025a87';

window.THREE = THREE;
window.SVGLoader = SVGLoader;
window.OBJExporter = OBJExporter;
window.BufferGeometryUtils = BufferGeometryUtils;
