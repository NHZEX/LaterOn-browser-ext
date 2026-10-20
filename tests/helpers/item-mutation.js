// Run the real backend mutation code behind browser mocks used by DOM tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
module.exports = function install(window) {
  if (!window.chrome?.runtime || window.__itemMutationMock) return;
  window.__itemMutationMock = true;
  const storageContext = vm.createContext({ Date, crypto: window.crypto,
    chrome: { storage: window.chrome.storage, runtime: { onMessage: { addListener() {} } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../modules/storage/coordinator.js'), 'utf8'), storageContext);
  window.eval(fs.readFileSync(path.join(__dirname, '../../modules/storage/client.js'), 'utf8'));
  const original = window.chrome.runtime.sendMessage;
  window.chrome.runtime.sendMessage = async function(message, ...args) {
    if (message?.type === 'COLLECTION_COMMAND') {
      try { return await storageContext.LaterOnCollection.execute(message); }
      catch (error) { return { ok: false, error: error.message }; }
    }
    return original?.call(this, message, ...args);
  };
};
