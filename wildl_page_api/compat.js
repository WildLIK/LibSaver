// Firefox's browser namespace consistently returns Promises.
if (typeof browser !== 'undefined') globalThis.chrome = browser;
