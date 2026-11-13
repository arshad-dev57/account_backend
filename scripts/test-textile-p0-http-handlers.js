'use strict';

/**
 * Exercises textile Express handlers with a mocked authenticated request
 * (no password / JWT minting). Confirms sandbox gate + winding post + genealogy.
 */
require('dotenv').config();
const prisma = require('../prisma/client');
const textile = require('../controllers/textileManufacturingController');

function mockRes() {
  const out = { statusCode: 200, body: null };
  return {
    out,
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(payload) {
      out.body = payload;
      return this;
    }
  };
}

async function invoke(handler, { user, body = {}, params = {}, query = {} }) {
  const req = {
    user: { id: user.id, companyId: user.companyId },
    body,
    params,
    query
  };
  const res = mockRes();
  await handler(req, res);
  return res.out;
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: { contains: '@' } },
    orderBy: { createdAt: 'asc' }
  });
  if (!user) throw new Error('No user');

  console.log('A) ensure sandbox');
  let r = await invoke(textile.ensureSandbox, { user, body: { activate: true } });
  if (!r.body?.success) throw new Error(r.body?.message || 'ensure failed');
  const companyId = r.body.data.company.id;
  const masters = r.body.data.masters;
  user.companyId = companyId;
  console.log('   in sandbox', companyId, 'yarnLotKg', masters.yarnLotKg);

  console.log('B) live company should be blocked for winding list');
  const liveCompany = await prisma.company.findFirst({
    where: { isSandbox: false, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  if (liveCompany) {
    r = await invoke(textile.listWinding, {
      user: { id: user.id, companyId: liveCompany.id }
    });
    if (r.statusCode !== 403) throw new Error('Expected 403 outside sandbox');
    console.log('   blocked OK:', r.body.message);
  }

  console.log('C) post successful winding via handler');
  const coneWeights = Array.from({ length: 5 }, () => 20);
  r = await invoke(textile.createWinding, {
    user: { id: user.id, companyId },
    body: {
      post: true,
      yarnProductId: masters.yarnProductId,
      coneProductId: masters.coneProductId,
      yarnLotNumber: masters.yarnLotNumber,
      sourceWarehouseId: masters.warehouseId,
      outputWarehouseId: masters.warehouseId,
      machineId: masters.machineId,
      operatorName: 'Handler Tester',
      shift: 'B',
      productionDate: new Date().toISOString(),
      targetOutputKg: 100,
      inputWeightKg: 105,
      outputWeightKg: 100,
      wastageKg: 5,
      rejectedWeightKg: 0,
      remainingYarnKg: 0,
      runningHours: 4,
      downtimeHours: 0.25,
      cones: coneWeights.map((weightKg) => ({ weightKg, status: 'Available' }))
    }
  });
  if (!r.body?.success) throw new Error(r.body?.message || 'create winding failed');
  const entry = r.body.data;
  console.log('   posted', entry.entryNumber, 'cones', entry.cones?.length, 'status', entry.status);
  if (entry.status !== 'Posted' || entry.cones?.length !== 5) throw new Error('unexpected entry shape');

  console.log('D) cone genealogy');
  const coneId = entry.cones[0].id;
  r = await invoke(textile.getCone, {
    user: { id: user.id, companyId },
    params: { id: coneId }
  });
  if (!r.body?.success) throw new Error(r.body?.message || 'get cone failed');
  const lots = r.body.data.genealogy?.yarnLots || [];
  if (!lots.length || lots[0].lotNumber !== masters.yarnLotNumber) {
    throw new Error('genealogy missing yarn lot');
  }
  console.log('   cone', r.body.data.coneCode, '← LOT', lots[0].lotNumber);

  console.log('E) insufficient stock via handler');
  r = await invoke(textile.createWinding, {
    user: { id: user.id, companyId },
    body: {
      post: true,
      yarnProductId: masters.yarnProductId,
      coneProductId: masters.coneProductId,
      yarnLotNumber: masters.yarnLotNumber,
      sourceWarehouseId: masters.warehouseId,
      outputWarehouseId: masters.warehouseId,
      machineId: masters.machineId,
      operatorName: 'Handler Tester',
      inputWeightKg: 999999,
      outputWeightKg: 999990,
      wastageKg: 9,
      remainingYarnKg: 0,
      cones: [{ weightKg: 999990, status: 'Available' }]
    }
  });
  if (r.body?.success) throw new Error('insufficient stock should fail');
  console.log('   blocked OK:', r.body.message);

  console.log('F) foundation beam + roll');
  r = await invoke(textile.createBeam, {
    user: { id: user.id, companyId },
    body: { beamCode: `BEAM-P0-${Date.now().toString().slice(-6)}`, status: 'Draft' }
  });
  if (!r.body?.success) throw new Error(r.body?.message || 'beam failed');
  r = await invoke(textile.createRoll, {
    user: { id: user.id, companyId },
    body: { rollCode: `ROLL-P0-${Date.now().toString().slice(-6)}`, stage: 'Greige' }
  });
  if (!r.body?.success) throw new Error(r.body?.message || 'roll failed');
  console.log('   beam/roll foundation OK');

  console.log('PASS textile P0 handler tests');
}

main()
  .catch((err) => {
    console.error('FAIL', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
