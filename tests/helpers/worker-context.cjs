const { createContext } = require("node:vm");

const nativeStreams = { Blob, CompressionStream, DecompressionStream, ReadableStream, TransformStream, WritableStream };

function createWorkerContext(sandbox) {
  return createContext(Object.assign(sandbox, nativeStreams));
}

module.exports = { createWorkerContext, nativeStreams };
