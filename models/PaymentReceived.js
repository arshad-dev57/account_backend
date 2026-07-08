// models/PaymentReceived.js - Prisma Version - COMPLETE FIXED WITH DEBUG

const prisma = require('../prisma/client');

// ─── Generate Payment Number Function ──────────────────────
async function generatePaymentNumber(userId) {
  console.log('📝 [PaymentReceivedModel] generatePaymentNumber called for userId:', userId);
  
  const year = new Date().getFullYear();
  const prefix = `PMT-${year}-`;
  
  // Find the last payment number for this user
  const lastPayment = await prisma.paymentReceived.findFirst({
    where: {
      createdBy: userId,
      paymentNumber: {
        startsWith: prefix
      }
    },
    orderBy: {
      paymentNumber: 'desc'
    }
  });

  console.log('📝 [PaymentReceivedModel] lastPayment:', lastPayment);

  if (!lastPayment) {
    console.log('📝 [PaymentReceivedModel] No previous payment, returning:', `${prefix}0001`);
    return `${prefix}0001`;
  }

  const parts = lastPayment.paymentNumber.split('-');
  const lastNum = parseInt(parts[parts.length - 1]);
  const nextNum = lastNum + 1;
  
  const result = `${prefix}${String(nextNum).padStart(4, '0')}`;
  console.log('📝 [PaymentReceivedModel] Generated payment number:', result);
  return result;
}

class PaymentReceivedModel {
  // ============================================================
  // CREATE PAYMENT
  // ============================================================
  static async create(data) {
    console.log('📝 [PaymentReceivedModel] ========== CREATE START ==========');
    console.log('📝 [PaymentReceivedModel] Data received:', JSON.stringify(data, null, 2));
    
    try {
      const paymentNumber = await generatePaymentNumber(data.createdBy);
      console.log('📝 [PaymentReceivedModel] Generated payment number:', paymentNumber);
      
      // ─── Validate amount ──────────────────────────────────────────
      if (data.amount <= 0) {
        console.log('❌ [PaymentReceivedModel] Amount is 0 or negative:', data.amount);
        throw new Error('Payment amount must be greater than zero');
      }
      console.log('✅ [PaymentReceivedModel] Amount validated:', data.amount);

      // ─── Validate required fields ────────────────────────────────
      if (!data.customerId) {
        console.log('❌ [PaymentReceivedModel] customerId is missing');
        throw new Error('customerId is required');
      }
      if (!data.invoiceId) {
        console.log('❌ [PaymentReceivedModel] invoiceId is missing');
        throw new Error('invoiceId is required');
      }
      console.log('✅ [PaymentReceivedModel] Required fields validated');

      // ─── Create payment record ──────────────────────────────────
      console.log('📝 [PaymentReceivedModel] Creating payment in database...');
      const payment = await prisma.paymentReceived.create({
        data: {
          paymentNumber,
          paymentDate: data.paymentDate || new Date(),
          customerId: data.customerId,
          customerName: data.customerName || '',
          invoiceId: data.invoiceId,
          invoiceNumber: data.invoiceNumber || '',
          invoiceAmount: data.invoiceAmount || 0,
          amount: data.amount,
          paymentMethod: data.paymentMethod || 'Cash',
          reference: data.reference || '',
          bankAccountId: data.bankAccountId || null,
          bankAccountName: data.bankAccountName || '',
          notes: data.notes || '',
          status: data.status || 'Cleared',
          clearedDate: data.status === 'Cleared' ? new Date() : null,
          createdBy: data.createdBy,
          updatedBy: data.createdBy,
        },
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true }
          },
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      console.log('✅ [PaymentReceivedModel] Payment created successfully!');
      console.log('✅ [PaymentReceivedModel] Payment ID:', payment.id);
      console.log('✅ [PaymentReceivedModel] Payment Number:', payment.paymentNumber);
      console.log('✅ [PaymentReceivedModel] Payment Data:', JSON.stringify(payment, null, 2));
      console.log('📝 [PaymentReceivedModel] ========== CREATE END ==========');

      return payment;
    } catch (error) {
      console.error('❌ [PaymentReceivedModel] Error creating payment:', error);
      console.error('❌ [PaymentReceivedModel] Error stack:', error.stack);
      throw error;
    }
  }

  // ============================================================
  // GET ALL PAYMENTS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    console.log('📝 [PaymentReceivedModel] findAll called with filter:', filter);
    const { skip, take, orderBy = { paymentDate: 'desc' } } = options;
    
    const payments = await prisma.paymentReceived.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
    
    console.log('✅ [PaymentReceivedModel] findAll returned:', payments.length, 'payments');
    return payments;
  }

  // ============================================================
  // COUNT PAYMENTS
  // ============================================================
  static async count(filter = {}) {
    console.log('📝 [PaymentReceivedModel] count called with filter:', filter);
    const count = await prisma.paymentReceived.count({ where: filter });
    console.log('✅ [PaymentReceivedModel] count returned:', count);
    return count;
  }

  // ============================================================
  // FIND PAYMENT BY ID
  // ============================================================
  static async findById(id) {
    console.log('📝 [PaymentReceivedModel] findById called with id:', id);
    const payment = await prisma.paymentReceived.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        invoice: {
          select: { 
            id: true, 
            invoiceNumber: true, 
            grandTotal: true, 
            paidAmount: true,
            invoiceStatus: true 
          }
        }
      }
    });
    console.log('✅ [PaymentReceivedModel] findById result:', payment ? 'Found' : 'Not found');
    return payment;
  }

  // ============================================================
  // FIND PAYMENT BY PAYMENT NUMBER
  // ============================================================
  static async findByPaymentNumber(paymentNumber, userId) {
    console.log('📝 [PaymentReceivedModel] findByPaymentNumber called:', paymentNumber);
    return await prisma.paymentReceived.findFirst({
      where: {
        paymentNumber,
        createdBy: userId
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // FIND PAYMENTS BY CUSTOMER ID
  // ============================================================
  static async findByCustomerId(customerId, userId) {
    console.log('📝 [PaymentReceivedModel] findByCustomerId called:', customerId);
    return await prisma.paymentReceived.findMany({
      where: {
        customerId,
        createdBy: userId
      },
      orderBy: { paymentDate: 'desc' },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // FIND PAYMENTS BY INVOICE ID
  // ============================================================
  static async findByInvoiceId(invoiceId, userId) {
    console.log('📝 [PaymentReceivedModel] findByInvoiceId called:', invoiceId);
    return await prisma.paymentReceived.findMany({
      where: {
        invoiceId,
        createdBy: userId
      },
      orderBy: { paymentDate: 'desc' },
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });
  }

  // ============================================================
  // UPDATE PAYMENT
  // ============================================================
  static async update(id, data) {
    console.log('📝 [PaymentReceivedModel] update called for id:', id);
    return await prisma.paymentReceived.update({
      where: { id },
      data: {
        ...data,
        updatedBy: data.updatedBy,
        updatedAt: new Date(),
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // UPDATE PAYMENT STATUS (Clear cheque)
  // ============================================================
  static async updateStatus(id, status, userId) {
    console.log('📝 [PaymentReceivedModel] updateStatus called:', id, status);
    const updateData = { 
      status,
      updatedBy: userId,
      updatedAt: new Date()
    };
    
    if (status === 'Cleared') {
      updateData.clearedDate = new Date();
    }
    
    return await prisma.paymentReceived.update({
      where: { id },
      data: updateData,
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // DELETE PAYMENT WITH REVERSAL
  // ============================================================
  static async deletePayment(id, userId) {
    console.log('📝 [PaymentReceivedModel] deletePayment called for id:', id);
    return await prisma.$transaction(async (tx) => {
      // Get payment with details
      const payment = await tx.paymentReceived.findUnique({
        where: { id }
      });
      
      if (!payment) {
        console.log('❌ [PaymentReceivedModel] Payment not found:', id);
        return null;
      }
      
      console.log('✅ [PaymentReceivedModel] Payment found:', payment.paymentNumber);
      
      // Get invoice details
      const invoice = await tx.warehouseInvoice.findUnique({
        where: { id: payment.invoiceId }
      });
      
      // Reverse invoice paid amount
      if (invoice) {
        const newPaidAmount = invoice.paidAmount - payment.amount;
        const newStatus = newPaidAmount <= 0 ? 'Unpaid' : 'Partial';
        
        console.log('📝 [PaymentReceivedModel] Updating invoice:', invoice.invoiceNumber);
        await tx.warehouseInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            invoiceStatus: newStatus
          }
        });
      }
      
      // Delete payment
      const deleted = await tx.paymentReceived.delete({
        where: { id }
      });
      
      console.log('✅ [PaymentReceivedModel] Payment deleted:', deleted.id);
      return deleted;
    });
  }

  // ============================================================
  // GET PAYMENT STATS / KPI
  // ============================================================
  static async getStats(createdBy) {
    console.log('📝 [PaymentReceivedModel] getStats called for user:', createdBy);
    const filter = { createdBy };
    
    const [total, totalAmount, cleared, pending] = await Promise.all([
      prisma.paymentReceived.count({ where: filter }),
      prisma.paymentReceived.aggregate({
        where: filter,
        _sum: { amount: true }
      }),
      prisma.paymentReceived.count({
        where: { ...filter, status: 'Cleared' }
      }),
      prisma.paymentReceived.count({
        where: { ...filter, status: 'Pending' }
      })
    ]);

    const result = {
      total,
      totalAmount: totalAmount._sum.amount || 0,
      cleared,
      pending
    };
    console.log('✅ [PaymentReceivedModel] Stats result:', result);
    return result;
  }

  // ============================================================
  // GET PAYMENTS BY METHOD
  // ============================================================
  static async getByMethod(createdBy) {
    console.log('📝 [PaymentReceivedModel] getByMethod called for user:', createdBy);
    const payments = await prisma.paymentReceived.groupBy({
      by: ['paymentMethod'],
      where: { createdBy },
      _sum: { amount: true },
      _count: true
    });

    const result = payments.map(item => ({
      method: item.paymentMethod,
      count: item._count,
      totalAmount: item._sum.amount || 0
    }));
    console.log('✅ [PaymentReceivedModel] getByMethod result:', result);
    return result;
  }

  // ============================================================
  // SEARCH PAYMENTS
  // ============================================================
  static async search(query, createdBy, options = {}) {
    console.log('📝 [PaymentReceivedModel] search called with query:', query);
    const { skip, take } = options;

    const filter = {
      createdBy,
      OR: [
        { paymentNumber: { contains: query, mode: 'insensitive' } },
        { customerName: { contains: query, mode: 'insensitive' } },
        { invoiceNumber: { contains: query, mode: 'insensitive' } },
        { reference: { contains: query, mode: 'insensitive' } }
      ]
    };

    const payments = await prisma.paymentReceived.findMany({
      where: filter,
      skip,
      take,
      orderBy: { paymentDate: 'desc' },
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    const total = await prisma.paymentReceived.count({ where: filter });

    console.log('✅ [PaymentReceivedModel] search returned:', payments.length, 'payments');
    return { payments, total };
  }

  // ============================================================
  // GET CUSTOMER BALANCE
  // ============================================================
  static async getCustomerBalance(customerId, userId) {
    console.log('📝 [PaymentReceivedModel] getCustomerBalance called for:', customerId);
    const invoices = await prisma.warehouseInvoice.findMany({
      where: {
        customerId,
        createdBy: userId,
        invoiceStatus: { not: 'Paid' }
      }
    });

    const totalOutstanding = invoices.reduce(
      (sum, inv) => sum + (inv.grandTotal - inv.paidAmount),
      0
    );

    console.log('✅ [PaymentReceivedModel] Customer balance:', totalOutstanding);
    return totalOutstanding;
  }
}

module.exports = PaymentReceivedModel;