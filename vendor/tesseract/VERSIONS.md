# Vendored OCR runtime

The browser OCR path is intentionally same-origin. User documents and rendered
page pixels are processed inside the local web worker and are never sent to an
OCR service.

## Runtime

- `tesseract.esm.min.js` and `worker.min.js`: Tesseract.js browser runtime.
- `core/`: LSTM-only core assets from `tesseract.js-core@7.0.0`.
  - `tesseract-core-lstm.wasm.js`: non-SIMD fallback.
  - `tesseract-core-simd-lstm.wasm.js`: SIMD browsers.
  - `tesseract-core-relaxedsimd-lstm.wasm.js`: relaxed-SIMD browsers.
- `lang/eng.traineddata.gz`: English `4.0.0_fast` model.
- `lang/kor.traineddata.gz`: Korean `4.0.0_fast` model.

Only LSTM builds are included because the fast language models do not need the
larger legacy recognition engine. The three feature variants let Tesseract.js
select the fastest compatible core without an external fallback.

## SHA-256

```text
eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680  core/tesseract-core-lstm.wasm.js
861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3  core/tesseract-core-relaxedsimd-lstm.wasm.js
c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38  core/tesseract-core-simd-lstm.wasm.js
18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b  lang/eng.traineddata.gz
aae6df1bbd206053b366b0b0f00e2211637d0923e8c3c64a0cbc9edaf61a5896  lang/kor.traineddata.gz
```
