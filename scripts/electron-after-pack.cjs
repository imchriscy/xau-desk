/** electron-builder afterPack：移除错误的 Asar 完整性项（会导致窗口黑屏 / 资源读失败） */
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const plist = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Info.plist");
  if (!fs.existsSync(plist)) return;
  const { execFileSync } = require("node:child_process");
  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", "Delete :ElectronAsarIntegrity", plist], { stdio: "ignore" });
    console.log("[afterPack] removed ElectronAsarIntegrity from Info.plist");
  } catch {
  }
};
