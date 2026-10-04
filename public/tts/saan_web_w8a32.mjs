async function Module(moduleArg = {}) {
  var Module = moduleArg;
  var ENVIRONMENT_IS_WEB = true;
  var ENVIRONMENT_IS_WORKER = false;
  var programArgs = [];
  var thisProgram = "./this.program";
  var _scriptName = import.meta.url;
  var scriptDirectory = "";
  function locateFile(path) {
    if (Module["locateFile"]) {
      return Module["locateFile"](path, scriptDirectory);
    }
    return scriptDirectory + path;
  }
  var readAsync, readBinary;
  if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    try {
      scriptDirectory = new URL(".", _scriptName).href;
    } catch {}
    {
      readAsync = async (url) => {
        var response = await fetch(url, { credentials: "same-origin" });
        if (response.ok) {
          return response.arrayBuffer();
        }
        throw new Error(response.status + " : " + response.url);
      };
    }
  } else {
  }
  var out = console.log.bind(console);
  var err = console.error.bind(console);
  var wasmBinary;
  var ABORT = false;
  class EmscriptenEH {}
  class EmscriptenSjLj extends EmscriptenEH {}
  var runtimeInitialized = false;
  function getMemoryBuffer() {
    return wasmMemory.buffer;
  }
  function updateMemoryViews() {
    if (HEAP8?.buffer?.resizable) return;
    var b = getMemoryBuffer();
    HEAP8 = new Int8Array(b);
    Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
    Module["HEAP32"] = HEAP32 = new Int32Array(b);
    HEAPU32 = new Uint32Array(b);
    Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
  }
  function preRun() {
    var preRun = Module["preRun"];
    if (preRun) {
      if (typeof preRun == "function") preRun = [preRun];
      onPreRuns.push(...preRun);
    }
    callRuntimeCallbacks(onPreRuns);
  }
  function initRuntime() {
    runtimeInitialized = true;
    wasmExports["__wasm_call_ctors"]();
  }
  function postRun() {
    var postRun = Module["postRun"];
    if (postRun) {
      if (typeof postRun == "function") postRun = [postRun];
      onPostRuns.push(...postRun);
    }
    callRuntimeCallbacks(onPostRuns);
  }
  function abort(what) {
    Module["onAbort"]?.(what);
    what = `Aborted(${what})`;
    err(what);
    ABORT = true;
    what += ". Build with -sASSERTIONS for more info.";
    var e = new WebAssembly.RuntimeError(what);
    throw e;
  }
  var wasmBinaryFile;
  function findWasmBinary() {
    if (Module["locateFile"]) {
      return locateFile("saan_web_w8a32.wasm");
    }
    return new URL("saan_web_w8a32.wasm", import.meta.url).href;
  }
  function getBinarySync(file) {
    if (readBinary) {
      return readBinary(file);
    }
    throw "both async and sync fetching of the wasm failed";
  }
  async function getWasmBinary(binaryFile) {
    if (!wasmBinary) {
      try {
        var response = await readAsync(binaryFile);
        return new Uint8Array(response);
      } catch {}
    }
    return getBinarySync(binaryFile);
  }
  async function instantiateArrayBuffer(binaryFile, imports) {
    try {
      var binary = await getWasmBinary(binaryFile);
      var instance = await WebAssembly.instantiate(binary, imports);
      return instance;
    } catch (reason) {
      err(`failed to asynchronously prepare wasm: ${reason}`);
      abort(reason);
    }
  }
  async function instantiateAsync(binary, binaryFile, imports) {
    if (!binary) {
      try {
        var response = fetch(binaryFile, { credentials: "same-origin" });
        var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
        return instantiationResult;
      } catch (reason) {
        err(`wasm streaming compile failed: ${reason}`);
        err("falling back to ArrayBuffer instantiation");
      }
    }
    return instantiateArrayBuffer(binaryFile, imports);
  }
  function getWasmImports() {
    var imports = { env: wasmImports, wasi_snapshot_preview1: wasmImports };
    return imports;
  }
  async function createWasm() {
    function receiveInstance(instance) {
      wasmExports = instance.exports;
      assignWasmExports(wasmExports);
      updateMemoryViews();
      return wasmExports;
    }
    function receiveInstantiationResult(result) {
      return receiveInstance(result["instance"]);
    }
    var info = getWasmImports();
    var instantiateWasm = Module["instantiateWasm"];
    if (instantiateWasm) {
      return new Promise((resolve) => {
        instantiateWasm(info, (inst) => resolve(receiveInstance(inst)));
      });
    }
    wasmBinaryFile ??= findWasmBinary();
    var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
    var exports = receiveInstantiationResult(result);
    return exports;
  }
  class ExitStatus {
    name = "ExitStatus";
    constructor(status) {
      this.message = `Program terminated with exit(${status})`;
      this.status = status;
    }
  }
  var HEAP8;
  var callRuntimeCallbacks = (callbacks) => {
    while (callbacks.length > 0) {
      callbacks.shift()(Module);
    }
  };
  var onPostRuns = [];
  var onPreRuns = [];
  var noExitRuntime = true;
  var getHeapMax = () => 2147483648;
  var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
  var growMemory = (size) => {
    var oldHeapSize = wasmMemory.buffer.byteLength;
    var pages = ((size - oldHeapSize + 65535) / 65536) | 0;
    try {
      wasmMemory.grow(pages);
      updateMemoryViews();
      return 1;
    } catch (e) {}
  };
  var HEAPU8;
  var _emscripten_resize_heap = (requestedSize) => {
    var oldSize = HEAPU8.length;
    requestedSize >>>= 0;
    var maxHeapSize = getHeapMax();
    if (requestedSize > maxHeapSize) {
      return false;
    }
    for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
      var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
      overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
      var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
      var replacement = growMemory(newSize);
      if (replacement) {
        return true;
      }
    }
    return false;
  };
  var _fd_close = (fd) => 52;
  var INT53_MAX = 9007199254740992;
  var INT53_MIN = -9007199254740992;
  var bigintToI53Checked = (num) => (num < INT53_MIN || num > INT53_MAX ? NaN : Number(num));
  function _fd_seek(fd, offset, whence, newOffset) {
    offset = bigintToI53Checked(offset);
    return 70;
  }
  var printCharBuffers = [null, [], []];
  var UTF8Decoder = globalThis.TextDecoder && new TextDecoder();
  var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
    var maxIdx = idx + maxBytesToRead;
    if (ignoreNul) return maxIdx;
    while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
    return idx;
  };
  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
    var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
    if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
      return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
    }
    var str = "";
    while (idx < endPtr) {
      var u0 = heapOrArray[idx++];
      if (!(u0 & 128)) {
        str += String.fromCharCode(u0);
        continue;
      }
      var u1 = heapOrArray[idx++] & 63;
      if ((u0 & 224) == 192) {
        str += String.fromCharCode(((u0 & 31) << 6) | u1);
        continue;
      }
      var u2 = heapOrArray[idx++] & 63;
      if ((u0 & 240) == 224) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
      }
      if (u0 < 65536) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 65536;
        str += String.fromCharCode(55296 | (ch >> 10), 56320 | (ch & 1023));
      }
    }
    return str;
  };
  var printChar = (stream, curr) => {
    var buffer = printCharBuffers[stream];
    if (!curr || curr === 10) {
      (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
      buffer.length = 0;
    } else {
      buffer.push(curr);
    }
  };
  var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) =>
    ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : "";
  var HEAPU32;
  var _fd_write = (fd, iov, iovcnt, pnum) => {
    var num = 0;
    for (var i = 0; i < iovcnt; i++) {
      var ptr = HEAPU32[iov >> 2];
      var len = HEAPU32[(iov + 4) >> 2];
      iov += 8;
      for (var j = 0; j < len; j++) {
        printChar(fd, HEAPU8[ptr + j]);
      }
      num += len;
    }
    HEAPU32[pnum >> 2] = num;
    return 0;
  };
  var HEAPF32;
  var HEAP32;
  var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
    if (!(maxBytesToWrite > 0)) return 0;
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;
    for (var i = 0; i < str.length; ++i) {
      var u = str.codePointAt(i);
      if (u <= 127) {
        if (outIdx >= endIdx) break;
        heap[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) break;
        heap[outIdx++] = 192 | (u >> 6);
        heap[outIdx++] = 128 | (u & 63);
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) break;
        heap[outIdx++] = 224 | (u >> 12);
        heap[outIdx++] = 128 | ((u >> 6) & 63);
        heap[outIdx++] = 128 | (u & 63);
      } else {
        if (outIdx + 3 >= endIdx) break;
        heap[outIdx++] = 240 | (u >> 18);
        heap[outIdx++] = 128 | ((u >> 12) & 63);
        heap[outIdx++] = 128 | ((u >> 6) & 63);
        heap[outIdx++] = 128 | (u & 63);
        i++;
      }
    }
    heap[outIdx] = 0;
    return outIdx - startIdx;
  };
  var stringToUTF8 = (str, outPtr, maxBytesToWrite) =>
    stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
  var lengthBytesUTF8 = (str) => {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      var c = str.charCodeAt(i);
      if (c <= 127) {
        len++;
      } else if (c <= 2047) {
        len += 2;
      } else if (c >= 55296 && c <= 57343) {
        len += 4;
        ++i;
      } else {
        len += 3;
      }
    }
    return len;
  };
  {
    if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
    if (Module["print"]) out = Module["print"];
    if (Module["printErr"]) err = Module["printErr"];
    if (Module["arguments"]) programArgs = Module["arguments"];
    if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
    var preInit = Module["preInit"];
    if (preInit) {
      if (typeof preInit == "function") Module["preInit"] = preInit = [preInit];
      while (preInit.length > 0) {
        preInit.shift()();
      }
    }
  }
  Module["UTF8ToString"] = UTF8ToString;
  Module["stringToUTF8"] = stringToUTF8;
  Module["lengthBytesUTF8"] = lengthBytesUTF8;
  var _saan_web_alloc,
    _saan_web_init,
    _saan_web_synth,
    _saan_web_pcm,
    _saan_web_n_samples,
    _saan_web_n_ids,
    _saan_web_route,
    _saan_web_message,
    _saan_web_arena_used,
    _saan_web_sample_rate,
    _saan_web_lane,
    __emscripten_stack_restore,
    __emscripten_stack_alloc,
    _emscripten_stack_get_current,
    memory,
    __indirect_function_table,
    wasmMemory;
  function assignWasmExports(wasmExports) {
    _saan_web_alloc = Module["_saan_web_alloc"] = wasmExports["saan_web_alloc"];
    _saan_web_init = Module["_saan_web_init"] = wasmExports["saan_web_init"];
    _saan_web_synth = Module["_saan_web_synth"] = wasmExports["saan_web_synth"];
    _saan_web_pcm = Module["_saan_web_pcm"] = wasmExports["saan_web_pcm"];
    _saan_web_n_samples = Module["_saan_web_n_samples"] = wasmExports["saan_web_n_samples"];
    _saan_web_n_ids = Module["_saan_web_n_ids"] = wasmExports["saan_web_n_ids"];
    _saan_web_route = Module["_saan_web_route"] = wasmExports["saan_web_route"];
    _saan_web_message = Module["_saan_web_message"] = wasmExports["saan_web_message"];
    _saan_web_arena_used = Module["_saan_web_arena_used"] = wasmExports["saan_web_arena_used"];
    _saan_web_sample_rate = Module["_saan_web_sample_rate"] = wasmExports["saan_web_sample_rate"];
    _saan_web_lane = Module["_saan_web_lane"] = wasmExports["saan_web_lane"];
    __emscripten_stack_restore = wasmExports["_emscripten_stack_restore"];
    __emscripten_stack_alloc = wasmExports["_emscripten_stack_alloc"];
    _emscripten_stack_get_current = wasmExports["emscripten_stack_get_current"];
    memory = wasmMemory = wasmExports["memory"];
    __indirect_function_table = wasmExports["__indirect_function_table"];
  }
  var wasmImports = {
    emscripten_resize_heap: _emscripten_resize_heap,
    fd_close: _fd_close,
    fd_seek: _fd_seek,
    fd_write: _fd_write,
  };
  async function run() {
    preRun();
    var setStatus = Module["setStatus"];
    if (setStatus) {
      setStatus("Running...");
      await new Promise((resolve) => setTimeout(resolve, 1));
      setTimeout(setStatus, 1, "");
    }
    if (ABORT) return;
    initRuntime();
    Module["onRuntimeInitialized"]?.();
    postRun();
  }
  var wasmExports;
  wasmExports = await createWasm();
  await run();
  return Module;
}
export default Module;
