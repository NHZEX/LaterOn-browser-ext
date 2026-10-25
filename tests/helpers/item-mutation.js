// Run the real backend mutation code behind browser mocks used by DOM tests.
const vm = require('vm');
const defaultRead = require('./read-runtime.cjs');
module.exports = function install(window, read = defaultRead) {
  if (!window.chrome?.runtime || window.__itemMutationMock) return;
  window.__itemMutationMock = true;
  window.fetch ??= async () => ({}); // Built modulepreload fetches are an external resource boundary.
  if (window.document.querySelector('#libraryHeader') && !window.LaterOnI18n) window.eval(read('i18n.js'));
  window.eval(read('item-edit.js'));
  window.eval(read('item-state.js'));
  window.eval(read('collection-filter.js'));
  const storageContext = vm.createContext({ Date, crypto: window.crypto,
    chrome: { storage: window.chrome.storage, runtime: { onMessage: { addListener() {} } } } });
  vm.runInContext(read('storage-coordinator.js'), storageContext);
  window.eval(read('storage-client.js'));
  const original = window.chrome.runtime.sendMessage;
  window.chrome.runtime.sendMessage = async function(message, ...args) {
    if (message?.type === 'COLLECTION_COMMAND') {
      try { return await storageContext.LaterOnCollection.execute(message); }
      catch (error) { return { ok: false, error: error.message }; }
    }
    return original?.call(this, message, ...args);
  };
};
