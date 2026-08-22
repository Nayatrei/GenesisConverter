import * as THREE from './vendor/three/build/three.module.js?v=r-cdac17424b8832cf';
import { SVGLoader } from './vendor/three/examples/jsm/loaders/SVGLoader.js?v=r-cdac17424b8832cf';
import { OBJExporter } from './vendor/three/examples/jsm/exporters/OBJExporter.js?v=r-cdac17424b8832cf';
import * as BufferGeometryUtils from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js?v=r-cdac17424b8832cf';

window.THREE = THREE;
window.SVGLoader = SVGLoader;
window.OBJExporter = OBJExporter;
window.BufferGeometryUtils = BufferGeometryUtils;
