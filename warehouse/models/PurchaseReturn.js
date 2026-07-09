// warehouse/models/PurchaseReturn.js - COMPLETE

const prisma = require('../../prisma/client');

// ─── Generate Return Number ──────────────────────────────
function generateReturnNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PR-${year}${month}${day}-${random}`;
}

// ─── Helper: Find AP Account ──────────────────────────────
async function findAPAccount(tx, userId) {
  let account = await tx.chartOfAccount.findFirst({
    where: {
      userId: userId,
      isActive: true,
      OR: [
        { code: '2000' },
        { name: { contains: 'Accounts Payable', mode: 'insensitive' } }
      ]
    }
  });

  if (!account) {
    account = await tx.chartOfAccount.findFirst({
      where: {
        createdBy: userId,
        isActive: true,
        OR: [
          { code: '2000' },
          { name: { contains: 'Accounts Payable', mode: 'insensitive' } }
        ]
      }
    });
  }

  return account;
}

// ─── Helper: Find Inventory Account ──────────────────────
async function findInventoryAccount(tx, userId) {
  let account = await tx.chartOfAccount.findFirst({
    where: {
      userId: userId,
      isActive: true,
      OR: [
        { code: '1200' },
        { name: { contains: 'Inventory', mode: 'insensitive' } }
      ]
    }
  });

  if (!account) {
    account = await tx.chartOfAccount.findFirst({
      where: {
        createdBy: userId,
        isActive: true,
        OR: [
          { code: '1200' },
          { name: { contains: 'Inventory', mode: 'insensitive' } }
        ]
      }
    });
  }

  return account;
}

// ─── Helper: Get or create Purchase Returns account ──────
async function getOrCreatePurchaseReturnsAccount(tx, userId) {
  let account = await tx.chartOfAccount.findFirst({
    where: {
      userId: userId,
      isActive: true,
      OR: [
        { code: '5100' },
        { name: { contains: 'Purchase Returns', mode: 'insensitive' } }
      ]
    }
  });

  if (!account) {
    account = await tx.chartOfAccount.findFirst({
      where: {
        createdBy: userId,
        isActive: true,
        OR: [
          { code: '5100' },
          { name: { contains: 'Purchase Returns', mode: 'insensitive' } }
        ]
      }
    });
  }

  if (!account) {
    const maxCode = await tx.chartOfAccount.aggregate({
      where: { createdBy: userId },
      _max: { code: true }
    });
    
    let newCode = '5100';
    if (maxCode._max.code) {
      const num = parseInt(maxCode._max.code) + 1;
      newCode = num.toString();
    }

    account = await tx.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Purchase Returns',
        type: 'Expense',
        parentAccount: 'Cost of Goods Sold',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Purchase returns account - DO NOT DELETE',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId,
        userId: userId
      }
    });
  }

  return account;
}

class PurchaseReturnModel {
  // ============================================================
  // GET INVOICE PRODUCTS FOR RETURN
  // ============================================================
  static async getInvoiceProducts(invoiceId, userId) {
    const invoice = await prisma.purchaseInvoice.findFirst({
      where: {
        id: invoiceId,
        userId: userId,
        isActive: true,
        isDeleted: false,
        invoiceStatus: {
          in: ['Posted', 'Partially Paid', 'Paid']
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    if (!invoice) {
      throw new Error('Purchase invoice not found');
    }

    // Get previously returned quantities for each product
    const previousReturns = await prisma.purchaseReturnItem.groupBy({
      by: ['productId', 'purchaseInvoiceId'],
      where: {
        purchaseInvoiceId: invoiceId,
        return: {
          status: {
            in: ['Draft', 'Processed']
          },
          isActive: true,
          isDeleted: false
        }
      },
      _sum: {
        returnQuantity: true
      }
    });

    const returnMap = {};
    previousReturns.forEach(item => {
      returnMap[item.productId] = item._sum.returnQuantity || 0;
    });

    // Calculate available quantities
    const products = invoice.items.map(item => {
      const previouslyReturned = returnMap[item.productId] || 0;
      const availableQuantity = item.quantity - previouslyReturned;

      return {
        ...item,
        product: item.product,
        previouslyReturned: previouslyReturned,
        availableQuantity: Math.max(0, availableQuantity),
        isBoxBased: item.product?.isBoxBased || false,
        boxQuantity: item.product?.boxQuantity || 0,
        boxUnitName: item.product?.boxUnitName || 'Box'
      };
    });

    return {
      invoice,
      products
    };
  }

  // ============================================================
  // CREATE PURCHASE RETURN (DRAFT)
  // ============================================================
  static async createDraft(data) {
    const returnNumber = generateReturnNumber();

    return await prisma.$transaction(async (tx) => {
      const {
        supplierId,
        supplierName,
        purchaseInvoiceId,
        purchaseInvoiceNumber,
        returnReason,
        notes,
        items,
        userId,
        createdBy
      } = data;

      // ─── Validation ──────────────────────────────────────────
      if (!supplierId) {
        throw new Error('Supplier is required');
      }

      if (!purchaseInvoiceId) {
        throw new Error('Purchase invoice is required');
      }

      if (!items || items.length === 0) {
        throw new Error('At least one product must be returned');
      }

      // ─── Validate Supplier ──────────────────────────────────
      const supplier = await tx.supplier.findFirst({
        where: {
          id: supplierId,
          userId: userId,
          status: 'active'
        }
      });

      if (!supplier) {
        throw new Error('Supplier not found');
      }

      // ─── Validate Invoice ────────────────────────────────────
      const invoice = await tx.purchaseInvoice.findFirst({
        where: {
          id: purchaseInvoiceId,
          userId: userId,
          isActive: true,
          isDeleted: false
        },
        include: {
          items: true
        }
      });

      if (!invoice) {
        throw new Error('Purchase invoice not found');
      }

      // ─── Validate Items ──────────────────────────────────────
      let totalReturnQty = 0;
      let returnAmount = 0;
      let grandTotal = 0;
      const validatedItems = [];

      for (const item of items) {
        const invoiceItem = invoice.items.find(i => i.id === item.purchaseInvoiceItemId);
        
        if (!invoiceItem) {
          throw new Error(`Product ${item.productName} not found in invoice`);
        }

        // Check available quantity
        const previousReturns = await tx.purchaseReturnItem.aggregate({
          where: {
            purchaseInvoiceId: purchaseInvoiceId,
            productId: item.productId,
            return: {
              status: {
                in: ['Draft', 'Processed']
              },
              isActive: true,
              isDeleted: false,
              NOT: {
                id: item.returnId || '' // Exclude current return if updating
              }
            }
          },
          _sum: {
            returnQuantity: true
          }
        });

        const previouslyReturned = previousReturns._sum.returnQuantity || 0;
        const availableQuantity = invoiceItem.quantity - previouslyReturned;

        if (item.returnQuantity > availableQuantity) {
          throw new Error(
            `Return quantity ${item.returnQuantity} exceeds available quantity ${availableQuantity} for ${item.productName}`
          );
        }

        if (item.returnQuantity <= 0) {
          throw new Error(`Return quantity must be greater than 0 for ${item.productName}`);
        }

        const lineTotal = item.returnQuantity * invoiceItem.unitPrice;

        totalReturnQty += item.returnQuantity;
        returnAmount += lineTotal;
        grandTotal += lineTotal;

        validatedItems.push({
          ...item,
          lineTotal,
          unitPrice: invoiceItem.unitPrice,
          purchasedQuantity: invoiceItem.quantity,
          availableQuantity: availableQuantity,
          previouslyReturned: previouslyReturned
        });
      }

      // ─── Create Purchase Return ─────────────────────────────
      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          returnNumber,
          returnDate: new Date(),
          supplierId,
          supplierName: supplier.name,
          purchaseInvoiceId,
          purchaseInvoiceNumber: invoice.invoiceNumber,
          returnReason: returnReason || 'Return',
          status: 'Draft',
          notes: notes || '',
          totalReturnQty,
          returnAmount,
          grandTotal,
          createdBy,
          userId,
          items: {
            create: validatedItems.map(item => ({
              productId: item.productId,
              productName: item.productName,
              sku: item.sku || '',
              purchaseInvoiceId: purchaseInvoiceId,
              purchaseInvoiceItemId: item.purchaseInvoiceItemId,
              purchasedQuantity: item.purchasedQuantity,
              previouslyReturned: item.previouslyReturned,
              availableQuantity: item.availableQuantity,
              returnQuantity: item.returnQuantity,
              isBoxBased: item.isBoxBased || false,
              boxes: item.boxes || null,
              quantityPerBox: item.quantityPerBox || 0,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              returnReason: item.returnReason || returnReason || 'Return',
              condition: item.condition || 'Good',
              notes: item.notes || ''
            }))
          }
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          purchaseInvoice: true
        }
      });

      return purchaseReturn;
    });
  }

  // ============================================================
  // PROCESS PURCHASE RETURN
  // ============================================================
  static async processReturn(id, userId) {
    return await prisma.$transaction(async (tx) => {
      const purchaseReturn = await tx.purchaseReturn.findFirst({
        where: {
          id,
          userId: userId,
          isActive: true,
          isDeleted: false
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          purchaseInvoice: {
            include: {
              accountsPayable: true
            }
          }
        }
      });

      if (!purchaseReturn) {
        throw new Error('Purchase return not found');
      }

      if (purchaseReturn.status === 'Processed') {
        throw new Error('Purchase return already processed');
      }

      if (purchaseReturn.status === 'Cancelled') {
        throw new Error('Purchase return is cancelled');
      }

      // ─── Get Accounts ────────────────────────────────────────
      const apAccount = await findAPAccount(tx, userId);
      if (!apAccount) {
        throw new Error('Accounts Payable account not found');
      }

      const inventoryAccount = await findInventoryAccount(tx, userId);
      if (!inventoryAccount) {
        throw new Error('Inventory account not found');
      }

      const purchaseReturnsAccount = await getOrCreatePurchaseReturnsAccount(tx, userId);

      // ─── Create Journal Entry ────────────────────────────────
      const entryNumber = `JE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: new Date(),
          description: `Purchase return #${purchaseReturn.returnNumber} from ${purchaseReturn.supplier.name}`,
          reference: purchaseReturn.returnNumber,
          status: 'Posted',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          userId: userId,
          lines: {
            create: [
              // Debit: Accounts Payable
              {
                accountId: apAccount.id,
                accountName: apAccount.name,
                accountCode: apAccount.code,
                debit: purchaseReturn.grandTotal,
                credit: 0
              },
              // Credit: Purchase Returns (or Inventory)
              {
                accountId: purchaseReturnsAccount.id,
                accountName: purchaseReturnsAccount.name,
                accountCode: purchaseReturnsAccount.code,
                debit: 0,
                credit: purchaseReturn.grandTotal
              }
            ]
          }
        },
        include: {
          lines: {
            include: {
              account: true
            }
          }
        }
      });

      // ─── Update Purchase Return ──────────────────────────────
      const updatedReturn = await tx.purchaseReturn.update({
        where: { id },
        data: {
          status: 'Processed',
          journalEntryId: journalEntry.id,
          processedBy: userId,
          processedAt: new Date(),
          updatedBy: userId
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          purchaseInvoice: true,
          journalEntry: {
            include: {
              lines: {
                include: {
                  account: true
                }
              }
            }
          }
        }
      });

      // ─── Update Inventory Stock ──────────────────────────────
      for (const item of purchaseReturn.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId }
        });

        if (!product) continue;

        const newStock = product.currentStock - item.returnQuantity;

        await tx.product.update({
          where: { id: item.productId },
          data: {
            currentStock: newStock,
            availableStock: newStock
          }
        });

        // ─── Create Stock Movement ─────────────────────────────
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            productName: item.productName,
            type: 'Return',
            quantity: item.returnQuantity,
            previousStock: product.currentStock,
            newStock: newStock,
            stockType: 'bulk',
            reason: 'Purchase Return',
            supplierId: purchaseReturn.supplierId,
            supplierName: purchaseReturn.supplier.name,
            reference: purchaseReturn.returnNumber,
            status: 'Completed',
            notes: `Returned ${item.returnQuantity} ${item.productName} - ${purchaseReturn.returnReason}`,
            createdBy: userId,
            userId: userId
          }
        });
      }

      // ─── Handle Invoice Outstanding ──────────────────────────
      const invoice = purchaseReturn.purchaseInvoice;
      
      if (invoice.paymentStatus === 'Unpaid' || invoice.paymentStatus === 'Partial') {
        // Reduce outstanding amount
        const newOutstanding = invoice.outstanding - purchaseReturn.grandTotal;
        const newPaidAmount = invoice.paidAmount;
        
        let invoiceStatus = invoice.invoiceStatus;
        let paymentStatus = invoice.paymentStatus;

        if (newOutstanding <= 0) {
          invoiceStatus = 'Paid';
          paymentStatus = 'Paid';
        } else if (newOutstanding < invoice.grandTotal) {
          invoiceStatus = 'Partially Paid';
          paymentStatus = 'Partial';
        }

        await tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: {
            outstanding: Math.max(0, newOutstanding),
            invoiceStatus: invoiceStatus,
            paymentStatus: paymentStatus
          }
        });

        // Update Accounts Payable
        await tx.accountsPayable.updateMany({
          where: { invoiceId: invoice.id },
          data: {
            outstanding: Math.max(0, newOutstanding),
            status: newOutstanding <= 0 ? 'Paid' : 'Current'
          }
        });
      } else if (invoice.paymentStatus === 'Paid') {
        // Invoice is fully paid - create Supplier Credit/Refund
        // This will be handled by creating a credit note or refund
        // For now, we'll mark it for manual processing
        console.log(`Invoice ${invoice.invoiceNumber} is fully paid. Supplier credit/refund required.`);
      }

      // ─── Update Supplier Outstanding Balance ──────────────────
      const totalOutstanding = await tx.purchaseInvoice.aggregate({
        where: {
          supplierId: purchaseReturn.supplierId,
          userId: userId,
          isActive: true,
          isDeleted: false,
          invoiceStatus: {
            in: ['Posted', 'Partially Paid']
          }
        },
        _sum: {
          outstanding: true
        }
      });

      // Note: If supplier has outstanding balance field, update it here
      // Currently Supplier model doesn't have outstanding balance field
      // You can add it if needed

      return updatedReturn;
    });
  }

  // ============================================================
  // CANCEL PURCHASE RETURN
  // ============================================================
  static async cancelReturn(id, userId, reason = '') {
    return await prisma.$transaction(async (tx) => {
      const purchaseReturn = await tx.purchaseReturn.findFirst({
        where: {
          id,
          userId: userId,
          isActive: true,
          isDeleted: false
        },
        include: {
          items: {
            include: {
              product: true
            }
          }
        }
      });

      if (!purchaseReturn) {
        throw new Error('Purchase return not found');
      }

      if (purchaseReturn.status === 'Cancelled') {
        throw new Error('Purchase return already cancelled');
      }

      if (purchaseReturn.status === 'Processed') {
        throw new Error('Cannot cancel a processed return. Please reverse the transaction.');
      }

      // ─── Update Purchase Return ──────────────────────────────
      const cancelledReturn = await tx.purchaseReturn.update({
        where: { id },
        data: {
          status: 'Cancelled',
          cancelledBy: userId,
          cancelledAt: new Date(),
          notes: purchaseReturn.notes 
            ? `${purchaseReturn.notes}\nCancelled: ${reason}`
            : `Cancelled: ${reason}`,
          updatedBy: userId
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          purchaseInvoice: true
        }
      });

      return cancelledReturn;
    });
  }

  // ============================================================
  // GET RETURN BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.purchaseReturn.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: true,
            purchaseInvoice: {
              include: {
                supplier: true
              }
            }
          }
        },
        supplier: true,
        purchaseInvoice: {
          include: {
            supplier: true,
            items: true
          }
        },
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        canceller: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET RETURN BY NUMBER
  // ============================================================
  static async findByReturnNumber(returnNumber) {
    return await prisma.purchaseReturn.findUnique({
      where: { returnNumber },
      include: {
        items: {
          include: {
            product: true
          }
        },
        supplier: true,
        purchaseInvoice: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        }
      }
    });
  }

  // ============================================================
  // GET ALL RETURNS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;

    return await prisma.purchaseReturn.findMany({
      where: {
        ...filter,
        isActive: true,
        isDeleted: false
      },
      skip,
      take,
      orderBy,
      include: {
        items: {
          include: {
            product: true
          }
        },
        supplier: true,
        purchaseInvoice: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT RETURNS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.purchaseReturn.count({
      where: {
        ...filter,
        isActive: true,
        isDeleted: false
      }
    });
  }

  // ============================================================
  // GET RETURN STATS
  // ============================================================
  static async getStats(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      userId: userId
    };

    const todayReturns = await prisma.purchaseReturn.count({
      where: {
        ...baseFilter,
        returnDate: { gte: today },
        status: 'Processed'
      }
    });

    const todayAmount = await prisma.purchaseReturn.aggregate({
      where: {
        ...baseFilter,
        returnDate: { gte: today },
        status: 'Processed'
      },
      _sum: { grandTotal: true }
    });

    const monthReturns = await prisma.purchaseReturn.count({
      where: {
        ...baseFilter,
        returnDate: { gte: startOfMonth },
        status: 'Processed'
      }
    });

    const monthAmount = await prisma.purchaseReturn.aggregate({
      where: {
        ...baseFilter,
        returnDate: { gte: startOfMonth },
        status: 'Processed'
      },
      _sum: { grandTotal: true }
    });

    const draftCount = await prisma.purchaseReturn.count({
      where: {
        ...baseFilter,
        status: 'Draft'
      }
    });

    return {
      today: {
        count: todayReturns,
        amount: todayAmount._sum.grandTotal || 0
      },
      month: {
        count: monthReturns,
        amount: monthAmount._sum.grandTotal || 0
      },
      draft: {
        count: draftCount
      }
    };
  }

  // ============================================================
  // PRINT RETURN NOTE DATA
  // ============================================================
  static async getReturnNoteData(id) {
    const purchaseReturn = await prisma.purchaseReturn.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: true
          }
        },
        supplier: true,
        purchaseInvoice: {
          include: {
            supplier: true
          }
        },
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!purchaseReturn) {
      throw new Error('Purchase return not found');
    }

    return purchaseReturn;
  }
}

module.exports = PurchaseReturnModel;