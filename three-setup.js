import * as THREE from './vendor/three/build/three.module.js?v=r-d45f015f257fd23c';
import { SVGLoader } from './vendor/three/examples/jsm/loaders/SVGLoader.js?v=r-d45f015f257fd23c';
import { OBJExporter } from './vendor/three/examples/jsm/exporters/OBJExporter.js?v=r-d45f015f257fd23c';
import * as BufferGeometryUtils from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js?v=r-d45f015f257fd23c';

window.THREE = THREE;
window.SVGLoader = SVGLoader;
window.OBJExporter = OBJExporter;
window.BufferGeometryUtils = BufferGeometryUtils;
