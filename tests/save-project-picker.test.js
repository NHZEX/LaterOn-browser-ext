require("./helpers/verify-picker-page.cjs")().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
