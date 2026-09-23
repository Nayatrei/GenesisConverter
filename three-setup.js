import * as THREE from './vendor/three/build/three.module.js?v=r-20104b195149121b';
import { SVGLoader } from './vendor/three/examples/jsm/loaders/SVGLoader.js?v=r-20104b195149121b';
import { OBJExporter } from './vendor/three/examples/jsm/exporters/OBJExporter.js?v=r-20104b195149121b';
import * as BufferGeometryUtils from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js?v=r-20104b195149121b';

window.THREE = THREE;
window.SVGLoader = SVGLoader;
window.OBJExporter = OBJExporter;
window.BufferGeometryUtils = BufferGeometryUtils;
