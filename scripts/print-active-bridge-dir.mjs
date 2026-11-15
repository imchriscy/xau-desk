#!/usr/bin/env node
import { pickActiveBridgeDir, persistUserBridgeDir } from "../gateway-mac/bridge-discover.mjs";

const dir = pickActiveBridgeDir() || "";
if (dir) persistUserBridgeDir(dir);
process.stdout.write(`${dir}\n`);
