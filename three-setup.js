import * as THREE from './vendor/three/build/three.module.js?v=r-09bfffa74eadf02c';
import { SVGLoader } from './vendor/three/examples/jsm/loaders/SVGLoader.js?v=r-09bfffa74eadf02c';
import { OBJExporter } from './vendor/three/examples/jsm/exporters/OBJExporter.js?v=r-09bfffa74eadf02c';
import * as BufferGeometryUtils from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js?v=r-09bfffa74eadf02c';

window.THREE = THREE;
window.SVGLoader = SVGLoader;
window.OBJExporter = OBJExporter;
window.BufferGeometryUtils = BufferGeometryUtils;
