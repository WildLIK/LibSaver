# mux.js 6.3.0

Unmodified `dist/mux-mp4.min.js` from the official npm tarball:
https://registry.npmjs.org/mux.js/-/mux.js-6.3.0.tgz

Source: https://github.com/videojs/mux.js/tree/v6.3.0
License: Apache-2.0; see `mux-LICENSE.txt`.
Tarball integrity: `sha512-/QTkbSAP2+w1nxV+qTcumSDN5PA98P0tjrADijIzQHe85oBK3Akhy9AHlH0ne/GombLMz1rLyvVsmrgRxoPDrQ==`.

The packaged worker uses the library to remux supported H.264/AAC MPEG-TS into fragmented MP4. No remote script is loaded at runtime. Container duration is finalized by WildLib after the last fragment; unsupported tracks produce an explicit error instead of being dropped.
