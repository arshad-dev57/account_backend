const prisma = require('../prisma/client');

/**
 * Generate sequential write-off number per company
 */
async function generateWriteOffNumber(companyId) {
  const count = await prisma.stockWriteOff.count({
    where: { companyId }
  });
  const seq = (count + 1).toString().padStart(5, '0');
  return `WO-${seq}`;
}

/**
 * Helper to ensure a Write-Off Expense Account exists in COA
 */
async function getOrCreateWriteOffExpenseAccount(companyId, userId) {
  let account = await prisma.chartOfAccount.findFirst({
    where: {
      companyId,
      OR: [
        { code: '5050' },
        { code: '6050' },
        { name: { contains: 'Write-Off', mode: 'insensitive' } },
        { name: { contains: 'Stock Loss', mode: 'insensitive' } }
      ]
    }
  });

  if (!account) {
    account = await prisma.chartOfAccount.create({
      data: {
        code: '5050',
        name: 'Inventory Write-Off Expense',
        type: 'Expense',
        parentAccount: 'Cost of Goods Sold',
        description: 'Account for stock write-offs due to damage, expiry, or loss',
        companyId,
        createdBy: userId,
        balanceType: 'Debit'
      }
    });
  }

  return account;
}

/**
 * Helper to get default Inventory Asset Account (prefer 1200 Inventory, never Prepaid 1300)
 */
async function getInventoryAssetAccount(companyId) {
  const { findOrCreateInventoryAccount } = require('../warehouse/services/stockAccountingService');
  return findOrCreateInventoryAccount(prisma, companyId, 'SYSTEM');
}

/**
 * 1. List Write-Offs
 */
exports.getStockWriteOffs = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { status, locationId, reason, startDate, endDate, page = 1, limit = 50 } = req.query;

    const where = {
      companyId,
      ...(status && { status }),
      ...(locationId && { locationId }),
      ...(reason && { reason }),
      ...(startDate && endDate && {
        writeOffDate: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      })
    };

    const p = parseInt(page);
    const l = parseInt(limit);

    const [total, writeOffs] = await Promise.all([
      prisma.stockWriteOff.count({ where }),
      prisma.stockWriteOff.findMany({
        where,
        include: {
          location: { select: { id: true, name: true, code: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          approver: { select: { id: true, firstName: true, lastName: true } },
          poster: { select: { id: true, firstName: true, lastName: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * l,
        take: l
      })
    ]);

    return res.json({
      success: true,
      data: writeOffs,
      pagination: {
        page: p,
        limit: l,
        total,
        totalPages: Math.ceil(total / l)
      }
    });
  } catch (error) {
    console.error('Error fetching stock write-offs:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Create Stock Write-Off Draft
 */
exports.createStockWriteOff = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      locationId,
      writeOffDate = new Date(),
      reason = 'Damaged',
      notes,
      items = []
    } = req.body;

    if (!locationId) {
      return res.status(400).json({ success: false, message: 'Warehouse/Location is required.' });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required for write-off.' });
    }

    const writeOffNumber = await generateWriteOffNumber(companyId);
    let totalCost = 0;

    // Validate available stock for each item
    const preparedItems = [];
    for (const item of items) {
      const product = await prisma.product.findFirst({
        where: { id: item.productId, companyId }
      });

      if (!product) {
        return res.status(400).json({ success: false, message: `Product ID ${item.productId} not found.` });
      }

      const productStock = await prisma.productStock.findFirst({
        where: { productId: item.productId, locationId, companyId }
      });

      const currentStock = productStock ? productStock.currentStock : product.currentStock || 0;
      const writeQty = parseFloat(item.quantity);

      if (writeQty <= 0) {
        return res.status(400).json({ success: false, message: `Quantity for ${product.name} must be greater than 0.` });
      }

      if (writeQty > currentStock) {
        return res.status(400).json({
          success: false,
          message: `Write-off quantity (${writeQty}) for ${product.name} exceeds available stock (${currentStock}) in selected warehouse.`
        });
      }

      const unitCost = parseFloat(item.unitCost) || product.averageCost || product.costPrice || 0;
      const itemTotalCost = writeQty * unitCost;
      totalCost += itemTotalCost;

      preparedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        batchNumber: item.batchNumber || product.batchNumber || null,
        expiryDate: item.expiryDate ? new Date(item.expiryDate) : product.expiryDate || null,
        unitOfMeasure: item.unitOfMeasure || product.stockUnitName || 'Pcs',
        availableStock: currentStock,
        quantity: writeQty,
        unitCost,
        totalCost: itemTotalCost,
        reason: item.reason || reason
      });
    }

    const expenseAccount = await getOrCreateWriteOffExpenseAccount(companyId, req.user.id);

    const writeOff = await prisma.stockWriteOff.create({
      data: {
        writeOffNumber,
        writeOffDate: new Date(writeOffDate),
        status: 'Draft',
        reason,
        notes,
        totalCost,
        companyId,
        locationId,
        expenseAccountId: expenseAccount.id,
        createdBy: req.user.id,
        items: {
          create: preparedItems
        }
      },
      include: {
        location: { select: { id: true, name: true } },
        items: true
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Stock Write-Off draft created successfully.',
      data: writeOff
    });
  } catch (error) {
    console.error('Error creating write-off:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Submit Stock Write-Off for Approval
 */
exports.submitStockWriteOff = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const writeOff = await prisma.stockWriteOff.findFirst({
      where: { id, companyId }
    });

    if (!writeOff) {
      return res.status(404).json({ success: false, message: 'Stock Write-Off record not found.' });
    }

    if (writeOff.status !== 'Draft') {
      return res.status(400).json({ success: false, message: `Only Draft write-offs can be submitted. Current status: ${writeOff.status}` });
    }

    const updated = await prisma.stockWriteOff.update({
      where: { id },
      data: {
        status: 'Submitted',
        submittedBy: req.user.id
      }
    });

    return res.json({
      success: true,
      message: 'Stock Write-Off submitted for approval.',
      data: updated
    });
  } catch (error) {
    console.error('Error submitting write-off:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Approve Stock Write-Off
 */
exports.approveStockWriteOff = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const writeOff = await prisma.stockWriteOff.findFirst({
      where: { id, companyId }
    });

    if (!writeOff) {
      return res.status(404).json({ success: false, message: 'Stock Write-Off record not found.' });
    }

    if (writeOff.status !== 'Submitted' && writeOff.status !== 'Draft') {
      return res.status(400).json({ success: false, message: `Cannot approve write-off in status ${writeOff.status}` });
    }

    const updated = await prisma.stockWriteOff.update({
      where: { id },
      data: {
        status: 'Approved',
        approvedBy: req.user.id
      }
    });

    return res.json({
      success: true,
      message: 'Stock Write-Off approved.',
      data: updated
    });
  } catch (error) {
    console.error('Error approving write-off:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Reject Stock Write-Off
 */
exports.rejectStockWriteOff = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { reason } = req.body;

    const writeOff = await prisma.stockWriteOff.findFirst({
      where: { id, companyId }
    });

    if (!writeOff) {
      return res.status(404).json({ success: false, message: 'Stock Write-Off record not found.' });
    }

    if (writeOff.status === 'Posted') {
      return res.status(400).json({ success: false, message: 'Cannot reject an already posted write-off.' });
    }

    const updated = await prisma.stockWriteOff.update({
      where: { id },
      data: {
        status: 'Rejected',
        notes: reason ? `Rejected: ${reason}` : writeOff.notes
      }
    });

    return res.json({
      success: true,
      message: 'Stock Write-Off rejected.',
      data: updated
    });
  } catch (error) {
    console.error('Error rejecting write-off:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. Post Stock Write-Off (IDEMPOTENT Execution)
 * - Updates ProductStock
 * - Logs StockMovement
 * - Posts JournalEntry (Dr Write-Off Expense, Cr Inventory Asset)
 */
exports.postStockWriteOff = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const writeOff = await prisma.stockWriteOff.findFirst({
      where: { id, companyId },
      include: {
        items: true,
        location: true
      }
    });

    if (!writeOff) {
      return res.status(404).json({ success: false, message: 'Stock Write-Off record not found.' });
    }

    // IDEMPOTENCY CHECK
    if (writeOff.status === 'Posted') {
      return res.json({
        success: true,
        message: 'Stock Write-Off is already posted.',
        data: writeOff
      });
    }

    if (writeOff.status !== 'Approved' && writeOff.status !== 'Submitted') {
      return res.status(400).json({
        success: false,
        message: `Write-Off must be Approved before posting. Current status: ${writeOff.status}`
      });
    }

    const expenseAccount = await getOrCreateWriteOffExpenseAccount(companyId, req.user.id);
    const inventoryAccount = await getInventoryAssetAccount(companyId);

    // Perform database transaction boundary
    const postedWriteOff = await prisma.$transaction(async (tx) => {
      // 1. Process items: reduce ProductStock & create StockMovement
      for (const item of writeOff.items) {
        // Find product
        const product = await tx.product.findUnique({
          where: { id: item.productId }
        });

        if (!product) continue;

        // Get ProductStock in this location
        let pStock = await tx.productStock.findFirst({
          where: { productId: item.productId, locationId: writeOff.locationId, companyId }
        });

        const prevStock = pStock ? pStock.currentStock : product.currentStock || 0;
        const newStock = Math.max(prevStock - item.quantity, 0);

        if (pStock) {
          await tx.productStock.update({
            where: { id: pStock.id },
            data: {
              currentStock: newStock,
              availableStock: Math.max(pStock.availableStock - item.quantity, 0)
            }
          });
        }

        // Also update product global current stock
        await tx.product.update({
          where: { id: product.id },
          data: {
            currentStock: Math.max(product.currentStock - item.quantity, 0),
            availableStock: Math.max(product.availableStock - item.quantity, 0)
          }
        });

        // Log StockMovement
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            productName: product.name,
            type: 'OUT',
            movementType: 'WRITE_OFF',
            quantity: -item.quantity,
            baseQuantity: -item.quantity,
            uom: item.unitOfMeasure || product.stockUnitName || 'Pcs',
            previousStock: prevStock,
            newStock,
            unitCost: item.unitCost,
            totalValue: item.totalCost,
            batchNumber: item.batchNumber,
            reason: `Write-Off: ${item.reason || writeOff.reason}`,
            reference: writeOff.writeOffNumber,
            status: 'Completed',
            notes: writeOff.notes,
            createdBy: req.user.id,
            companyId,
            locationId: writeOff.locationId
          }
        });
      }

      // 2. Post Journal Entry (Financial double-entry)
      let journalEntryId = null;
      if (writeOff.totalCost > 0 && expenseAccount && inventoryAccount) {
        const journalNumber = `JE-WO-${writeOff.writeOffNumber}`;

        const entry = await tx.journalEntry.create({
          data: {
            entryNumber: journalNumber,
            date: writeOff.writeOffDate,
            description: `Inventory Write-Off #${writeOff.writeOffNumber} (${writeOff.reason})`,
            reference: writeOff.writeOffNumber,
            status: 'Posted',
            type: 'WriteOff',
            createdBy: req.user.id,
            postedBy: req.user.id,
            postedAt: new Date(),
            companyId,
            locationId: writeOff.locationId,
            lines: {
              create: [
                {
                  accountId: expenseAccount.id,
                  accountName: expenseAccount.name,
                  accountCode: expenseAccount.code,
                  debit: writeOff.totalCost,
                  credit: 0
                },
                {
                  accountId: inventoryAccount.id,
                  accountName: inventoryAccount.name,
                  accountCode: inventoryAccount.code,
                  debit: 0,
                  credit: writeOff.totalCost
                }
              ]
            }
          }
        });
        journalEntryId = entry.id;
      }

      // 3. Mark Write-Off as Posted
      const updated = await tx.stockWriteOff.update({
        where: { id: writeOff.id },
        data: {
          status: 'Posted',
          postedBy: req.user.id,
          postedAt: new Date(),
          journalEntryId
        },
        include: {
          items: true,
          journalEntry: {
            include: { lines: true }
          }
        }
      });

      return updated;
    });

    return res.json({
      success: true,
      message: 'Stock Write-Off successfully posted, inventory updated, and journal entry created.',
      data: postedWriteOff
    });
  } catch (error) {
    console.error('Error posting write-off:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. Get Stock Write-Off by ID
 */
exports.getStockWriteOffById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const writeOff = await prisma.stockWriteOff.findFirst({
      where: { id, companyId },
      include: {
        location: { select: { id: true, name: true, code: true } },
        expenseAccount: { select: { id: true, name: true, code: true } },
        journalEntry: {
          include: { lines: true }
        },
        creator: { select: { id: true, firstName: true, lastName: true } },
        approver: { select: { id: true, firstName: true, lastName: true } },
        poster: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, currentStock: true } }
          }
        }
      }
    });

    if (!writeOff) {
      return res.status(404).json({ success: false, message: 'Write-off record not found.' });
    }

    return res.json({
      success: true,
      data: writeOff
    });
  } catch (error) {
    console.error('Error fetching write-off detail:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 8. Write-Off Reports & Analytics
 */
exports.getWriteOffReports = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { startDate, endDate, locationId } = req.query;

    const where = {
      companyId,
      status: 'Posted',
      ...(locationId && { locationId }),
      ...(startDate && endDate && {
        writeOffDate: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      })
    };

    const writeOffs = await prisma.stockWriteOff.findMany({
      where,
      include: {
        location: { select: { name: true } },
        items: true
      }
    });

    let totalLossValue = 0;
    let totalItemsCount = 0;
    const reasonBreakdown = {};
    const locationBreakdown = {};

    writeOffs.forEach(wo => {
      totalLossValue += wo.totalCost || 0;

      // Reason grouping
      const r = wo.reason || 'Other';
      reasonBreakdown[r] = (reasonBreakdown[r] || 0) + (wo.totalCost || 0);

      // Location grouping
      const locName = wo.location?.name || 'Main Warehouse';
      locationBreakdown[locName] = (locationBreakdown[locName] || 0) + (wo.totalCost || 0);

      totalItemsCount += wo.items.length;
    });

    return res.json({
      success: true,
      data: {
        totalWriteOffs: writeOffs.length,
        totalLossValue,
        totalItemsCount,
        reasonBreakdown,
        locationBreakdown,
        recentPostedWriteOffs: writeOffs.slice(0, 20)
      }
    });
  } catch (error) {
    console.error('Error generating write-off report:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
