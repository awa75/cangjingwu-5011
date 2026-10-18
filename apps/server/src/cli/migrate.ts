/**
 * CLI：手动执行迁移与初始化
 * 用法（在仓库根）：pnpm migrate
 */
import { assertConfig, describeConfig } from '../config.js';
import { closeDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { seed } from '../db/seed.js';

assertConfig();
for (const line of describeConfig()) console.log(`  ${line}`);
migrate();
seed();
closeDb();
console.log('\n迁移与初始化完成。');
