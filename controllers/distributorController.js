const prisma = require("../prisma/client");

// Helper: Auto-generate Salesperson Number
async function generateSalespersonNumber(companyId) {
  const count = await prisma.salesperson.count({
    where: { companyId }
  });
  const seq = (count + 1).toString().padStart(4, "0");
  return `SP-${seq}`;
}

// -------------------------------------------------------------
// 1. SALESPERSON MANAGEMENT
// -------------------------------------------------------------
exports.getSalespersons = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { search, status, territory, locationId } = req.query;

    const where = {
      companyId,
      ...(status && { status }),
      ...(territory && { territory: { contains: search, mode: "insensitive" } }),
      ...(locationId && { locationId }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { salespersonNumber: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } }
        ]
      })
    };

    const salespersons = await prisma.salesperson.findMany({
      where,
      include: {
        location: { select: { id: true, name: true } },
        hrEmployee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        _count: { select: { customers: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    const enhancedSalespersons = await Promise.all(
      salespersons.map(async (sp) => {
        const invoiceStats = await prisma.salesInvoice.aggregate({
          where: { salespersonId: sp.id, companyId },
          _sum: { grandTotal: true, paidAmount: true, outstanding: true }
        });

        const totalSales = invoiceStats._sum.grandTotal || 0;
        const totalRecovery = invoiceStats._sum.paidAmount || 0;
        const totalOutstanding = invoiceStats._sum.outstanding || 0;
        const targetAchievement = sp.monthlyTarget > 0 ? (totalSales / sp.monthlyTarget) * 100 : 0;

        return {
          ...sp,
          assignedCustomersCount: sp._count.customers,
          totalSales,
          totalRecovery,
          totalOutstanding,
          targetAchievement: Math.round(targetAchievement * 10) / 10
        };
      })
    );

    res.json({ success: true, data: enhancedSalespersons });
  } catch (error) {
    console.error("Error in getSalespersons:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createSalesperson = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      name,
      phone,
      email,
      employeeCode,
      status = "Active",
      territory,
      commissionRate = 0,
      monthlyTarget = 0,
      notes,
      userId,
      hrEmployeeId,
      locationId
    } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Salesperson name is required" });
    }

    const salespersonNumber = await generateSalespersonNumber(companyId);

    const salesperson = await prisma.salesperson.create({
      data: {
        salespersonNumber,
        name,
        phone,
        email,
        employeeCode,
        status,
        territory,
        commissionRate: parseFloat(commissionRate) || 0,
        monthlyTarget: parseFloat(monthlyTarget) || 0,
        notes,
        userId: userId || null,
        hrEmployeeId: hrEmployeeId || null,
        locationId: locationId || null,
        companyId,
        createdBy: req.user.id
      }
    });

    res.status(201).json({ success: true, data: salesperson, message: "Salesperson created successfully" });
  } catch (error) {
    console.error("Error in createSalesperson:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSalespersonById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const salesperson = await prisma.salesperson.findFirst({
      where: { id, companyId },
      include: {
        location: { select: { id: true, name: true } },
        hrEmployee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        customers: {
          select: {
            id: true,
            customerNumber: true,
            name: true,
            phone: true,
            territory: true,
            creditLimit: true,
            outstandingBalance: true,
            status: true
          }
        }
      }
    });

    if (!salesperson) {
      return res.status(404).json({ success: false, message: "Salesperson not found" });
    }

    const salesInvoices = await prisma.salesInvoice.findMany({
      where: { salespersonId: id, companyId },
      include: {
        customer: { select: { id: true, name: true } }
      },
      orderBy: { invoiceDate: "desc" },
      take: 100
    });

    const totalSales = salesInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
    const totalRecovery = salesInvoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
    const totalOutstanding = salesInvoices.reduce((sum, inv) => sum + (inv.outstanding || 0), 0);

    const now = new Date();
    const overdueInvoices = salesInvoices.filter(inv => inv.outstanding > 0 && inv.dueDate && new Date(inv.dueDate) < now);
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + (inv.outstanding || 0), 0);

    const targetAchievement = salesperson.monthlyTarget > 0 ? (totalSales / salesperson.monthlyTarget) * 100 : 0;

    res.json({
      success: true,
      data: {
        ...salesperson,
        metrics: {
          totalSales,
          totalRecovery,
          totalOutstanding,
          overdueAmount,
          monthlyTarget: salesperson.monthlyTarget,
          targetAchievement: Math.round(targetAchievement * 10) / 10,
          assignedCustomersCount: salesperson.customers.length
        },
        recentInvoices: salesInvoices
      }
    });
  } catch (error) {
    console.error("Error in getSalespersonById:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSalesperson = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const {
      name,
      phone,
      email,
      employeeCode,
      status,
      territory,
      commissionRate,
      monthlyTarget,
      notes,
      userId,
      hrEmployeeId,
      locationId
    } = req.body;

    const existing = await prisma.salesperson.findFirst({
      where: { id, companyId }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Salesperson not found" });
    }

    const updated = await prisma.salesperson.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(employeeCode !== undefined && { employeeCode }),
        ...(status && { status }),
        ...(territory !== undefined && { territory }),
        ...(commissionRate !== undefined && { commissionRate: parseFloat(commissionRate) || 0 }),
        ...(monthlyTarget !== undefined && { monthlyTarget: parseFloat(monthlyTarget) || 0 }),
        ...(notes !== undefined && { notes }),
        ...(userId !== undefined && { userId: userId || null }),
        ...(hrEmployeeId !== undefined && { hrEmployeeId: hrEmployeeId || null }),
        ...(locationId !== undefined && { locationId: locationId || null })
      }
    });

    res.json({ success: true, data: updated, message: "Salesperson updated successfully" });
  } catch (error) {
    console.error("Error in updateSalesperson:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.assignCustomersToSalesperson = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { customerIds = [] } = req.body;

    const salesperson = await prisma.salesperson.findFirst({
      where: { id, companyId }
    });

    if (!salesperson) {
      return res.status(404).json({ success: false, message: "Salesperson not found" });
    }

    await prisma.customer.updateMany({
      where: { companyId, id: { in: customerIds } },
      data: { salespersonId: id }
    });

    res.json({ success: true, message: `Assigned ${customerIds.length} customers to salesperson` });
  } catch (error) {
    console.error("Error in assignCustomersToSalesperson:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// -------------------------------------------------------------
// 2. CREDIT CONTROL & EXPOSURE ENGINE
// -------------------------------------------------------------
exports.checkCreditLimit = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { customerId, newAmount = 0 } = req.body;

    if (!customerId) {
      return res.status(400).json({ success: false, message: "Customer ID is required" });
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    // 1. AR Outstanding (Unpaid invoices)
    const invoiceSum = await prisma.salesInvoice.aggregate({
      where: { customerId, companyId, status: { notIn: ["Cancelled", "Paid"] } },
      _sum: { outstanding: true }
    });
    const arOutstanding = invoiceSum._sum.outstanding || 0;

    // 2. Open Orders (Unfulfilled Orders)
    const openOrdersSum = await prisma.order.aggregate({
      where: { customerId, companyId, status: { in: ["Pending", "Processing", "Approved"] } },
      _sum: { totalAmount: true }
    });
    const openOrdersAmount = openOrdersSum._sum.totalAmount || 0;

    // 3. Open Unbilled Deliveries
    const unbilledDeliveriesSum = await prisma.delivery.aggregate({
      where: { customerId, companyId, status: "Delivered", salesInvoiceId: null },
      _sum: { totalAmount: true }
    });
    const unbilledDeliveryAmount = unbilledDeliveriesSum._sum.totalAmount || 0;

    // Total Exposure Calculation
    const currentExposure = arOutstanding + openOrdersAmount + unbilledDeliveryAmount;
    const proposedAmount = parseFloat(newAmount) || 0;
    const projectedExposure = currentExposure + proposedAmount;
    const creditLimit = customer.creditLimit || 0;
    const creditPolicy = customer.creditPolicy || "WARN"; // ALLOW | WARN | BLOCK

    const isExceeded = creditLimit > 0 && projectedExposure > creditLimit;
    const availableCredit = creditLimit > 0 ? Math.max(0, creditLimit - currentExposure) : 999999999;
    const projectedRemainingCredit = creditLimit > 0 ? creditLimit - projectedExposure : 999999999;

    let decision = "ALLOW"; // ALLOW | WARN | BLOCK
    let message = "Credit check passed";

    if (isExceeded) {
      if (creditPolicy === "BLOCK") {
        decision = "BLOCK";
        message = `Transaction BLOCKED: Credit limit of PKR ${creditLimit.toLocaleString()} exceeded. Current exposure: PKR ${currentExposure.toLocaleString()}, Proposed: PKR ${proposedAmount.toLocaleString()}.`;
      } else if (creditPolicy === "WARN") {
        decision = "WARN";
        message = `WARNING: Credit limit of PKR ${creditLimit.toLocaleString()} will be exceeded by PKR ${Math.abs(projectedRemainingCredit).toLocaleString()}.`;
      }
    }

    res.json({
      success: true,
      data: {
        customerId,
        customerName: customer.name,
        creditLimit,
        creditPolicy,
        arOutstanding,
        openOrdersAmount,
        unbilledDeliveryAmount,
        currentExposure,
        proposedAmount,
        projectedExposure,
        availableCredit,
        projectedRemainingCredit,
        isExceeded,
        decision,
        message
      }
    });
  } catch (error) {
    console.error("Error in checkCreditLimit:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// -------------------------------------------------------------
// 3. CUSTOMER 360 & ACCOUNTING LEDGER & STATEMENT
// -------------------------------------------------------------
exports.getCustomer360 = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const customer = await prisma.customer.findFirst({
      where: { id, companyId },
      include: {
        salesperson: { select: { id: true, name: true, phone: true } },
        company: { select: { id: true, name: true } }
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    // Invoices
    const invoices = await prisma.salesInvoice.findMany({
      where: { customerId: id, companyId },
      orderBy: { invoiceDate: "desc" },
      take: 100
    });

    const totalSales = invoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
    const currentOutstanding = invoices.reduce((sum, inv) => sum + (inv.outstanding || 0), 0);

    const now = new Date();
    const overdueInvoices = invoices.filter(inv => inv.outstanding > 0 && inv.dueDate && new Date(inv.dueDate) < now);
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + (inv.outstanding || 0), 0);

    const availableCredit = customer.creditLimit > 0 ? Math.max(0, customer.creditLimit - currentOutstanding) : 0;

    // Payments
    const payments = await prisma.salesPaymentReceived.findMany({
      where: { customerId: id, companyId },
      orderBy: { paymentDate: "desc" },
      take: 100
    });

    // Orders
    const orders = await prisma.order.findMany({
      where: { customerId: id, companyId },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    // Deliveries
    const deliveries = await prisma.delivery.findMany({
      where: { customerId: id, companyId },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    // Credit Notes
    const creditNotes = await prisma.creditNote.findMany({
      where: { customerId: id, companyId },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    // Purchased Products Aggregation
    const invoiceItems = await prisma.salesInvoiceItem.findMany({
      where: { invoice: { customerId: id, companyId } },
      include: { product: { select: { id: true, name: true, sku: true, sellingPrice: true } } },
      take: 300
    });

    const productMap = new Map();
    invoiceItems.forEach(item => {
      const pid = item.productId || item.description;
      if (!pid) return;
      const name = item.product?.name || item.description || "Unknown";
      const sku = item.product?.sku || "-";
      const qty = item.quantity || 0;
      const total = item.total || 0;

      if (productMap.has(pid)) {
        const existing = productMap.get(pid);
        existing.totalQuantity += qty;
        existing.totalValue += total;
      } else {
        productMap.set(pid, {
          productId: pid,
          name,
          sku,
          totalQuantity: qty,
          totalValue: total,
          unitPrice: item.unitPrice || 0
        });
      }
    });

    const topProducts = Array.from(productMap.values()).sort((a, b) => b.totalValue - a.totalValue);

    res.json({
      success: true,
      data: {
        customer: {
          ...customer,
          availableCredit,
          currentOutstanding,
          overdueAmount,
          totalSales,
          totalPaid
        },
        financials: {
          creditLimit: customer.creditLimit || 0,
          currentOutstanding,
          overdueAmount,
          availableCredit,
          creditPolicy: customer.creditPolicy || "WARN",
          creditDays: customer.creditDays || 30,
          totalSales,
          totalPaid,
          totalOrders: orders.length,
          totalDeliveries: deliveries.length,
          totalCreditNotes: creditNotes.length
        },
        recentInvoices: invoices,
        recentPayments: payments,
        recentOrders: orders,
        recentDeliveries: deliveries,
        creditNotes,
        topProducts
      }
    });
  } catch (error) {
    console.error("Error in getCustomer360:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// -------------------------------------------------------------
// 3b. CUSTOMER ACCOUNT — period-filtered 360 for the customer page
// -------------------------------------------------------------
function dayStart(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function dayEnd(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(23, 59, 59, 999);
  return parsed;
}

function dayRange(field, start, end) {
  const filter = {};
  if (start) filter.gte = start;
  if (end) filter.lte = end;
  return Object.keys(filter).length ? { [field]: filter } : {};
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function deliveryState(order, deliveries) {
  if (!deliveries || deliveries.length === 0) {
    const flags = [order.orderStatus, order.fulfillmentStatus].map((s) => String(s || "").toLowerCase());
    return flags.includes("delivered") ? "Delivered" : "Not Delivered";
  }
  const states = deliveries.map((d) => String(d.deliveryStatus || "").toLowerCase());
  const delivered = states.filter((s) => s === "delivered" || s === "completed").length;
  if (delivered === states.length) return "Delivered";
  if (delivered > 0 || states.some((s) => s.includes("partial"))) return "Partially Delivered";
  return "Pending";
}

exports.getCustomerAccount = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const start = dayStart(req.query.from);
    const end = dayEnd(req.query.to);

    const customer = await prisma.customer.findFirst({
      where: { id, companyId, isDeleted: false },
      include: {
        salesperson: { select: { id: true, name: true, phone: true } },
        company: {
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
            email: true,
            logo: true,
            baseCurrency: { select: { code: true, symbol: true } }
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const invoiceScope = {
      customerId: id,
      companyId,
      isDeleted: false,
      invoiceStatus: { not: "Cancelled" }
    };
    const paymentScope = { customerId: id, companyId, isDeleted: false };
    const orderScope = { customerId: id, companyId, isDeleted: false };
    const deliveryScope = { customerId: id, companyId, isDeleted: false };

    const [invoices, allInvoices, payments, orders, deliveries, creditNotes] =
      await Promise.all([
        prisma.salesInvoice.findMany({
          where: { ...invoiceScope, ...dayRange("invoiceDate", start, end) },
          orderBy: { invoiceDate: "asc" },
          take: 1000
        }),
        prisma.salesInvoice.findMany({
          where: invoiceScope,
          select: {
            id: true,
            dueDate: true,
            grandTotal: true,
            paidAmount: true,
            outstanding: true
          },
          take: 5000
        }),
        prisma.salesPaymentReceived.findMany({
          where: { ...paymentScope, ...dayRange("paymentDate", start, end) },
          orderBy: { paymentDate: "asc" },
          take: 1000
        }),
        prisma.order.findMany({
          where: { ...orderScope, ...dayRange("orderDate", start, end) },
          orderBy: { orderDate: "desc" },
          take: 500,
          include: {
            items: {
              select: {
                productName: true,
                sku: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                taxAmount: true
              }
            }
          }
        }),
        prisma.delivery.findMany({
          where: { ...deliveryScope, ...dayRange("deliveryDate", start, end) },
          orderBy: { deliveryDate: "desc" },
          take: 500,
          include: {
            items: {
              select: {
                productName: true,
                sku: true,
                unit: true,
                orderedQuantity: true,
                deliveredQuantity: true,
                remainingQuantity: true
              }
            }
          }
        }),
        prisma.creditNote.findMany({
          where: { customerId: id, companyId, ...dayRange("date", start, end) },
          orderBy: { date: "asc" },
          take: 500
        })
      ]);

    // Opening balance for the selected period
    let openingBalance = 0;
    if (start) {
      const [priorInvoices, priorPayments, priorCredits] = await Promise.all([
        prisma.salesInvoice.aggregate({
          where: { ...invoiceScope, invoiceDate: { lt: start } },
          _sum: { grandTotal: true }
        }),
        prisma.salesPaymentReceived.aggregate({
          where: { ...paymentScope, paymentDate: { lt: start } },
          _sum: { amount: true }
        }),
        prisma.creditNote.aggregate({
          where: { customerId: id, companyId, date: { lt: start } },
          _sum: { amount: true }
        })
      ]);
      openingBalance =
        (priorInvoices._sum.grandTotal || 0) -
        (priorPayments._sum.amount || 0) -
        (priorCredits._sum.amount || 0);
    }

    // Delivery + invoice state per order (dates outside the period still count)
    const orderIds = orders.map((o) => o.id);
    const [orderDeliveries, orderInvoices] = orderIds.length
      ? await Promise.all([
          prisma.delivery.findMany({
            where: { salesOrderId: { in: orderIds }, companyId, isDeleted: false },
            orderBy: { deliveryDate: "asc" }
          }),
          prisma.salesInvoice.findMany({
            where: {
              orderId: { in: orderIds },
              companyId,
              isDeleted: false,
              invoiceStatus: { not: "Cancelled" }
            },
            select: {
              id: true,
              orderId: true,
              invoiceNumber: true,
              invoiceDate: true,
              grandTotal: true,
              paidAmount: true,
              outstanding: true
            }
          })
        ])
      : [[], []];

    const deliveriesByOrder = new Map();
    for (const delivery of orderDeliveries) {
      if (!deliveriesByOrder.has(delivery.salesOrderId)) deliveriesByOrder.set(delivery.salesOrderId, []);
      deliveriesByOrder.get(delivery.salesOrderId).push(delivery);
    }

    const invoicesByOrder = new Map();
    for (const invoice of orderInvoices) {
      if (!invoicesByOrder.has(invoice.orderId)) invoicesByOrder.set(invoice.orderId, []);
      invoicesByOrder.get(invoice.orderId).push(invoice);
    }

    const orderRows = orders.map((order) => {
      const linkedDeliveries = deliveriesByOrder.get(order.id) || [];
      const linkedInvoices = invoicesByOrder.get(order.id) || [];
      const invoiced = linkedInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
      const invoicePaid = linkedInvoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
      const paid =
        linkedInvoices.length > 0
          ? invoicePaid
          : String(order.paymentStatus || "").toLowerCase() === "paid"
            ? order.grandTotal || 0
            : 0;
      const billed = linkedInvoices.length > 0 ? invoiced : order.grandTotal || 0;
      const deliveredDates = linkedDeliveries
        .filter((d) => ["delivered", "completed"].includes(String(d.deliveryStatus || "").toLowerCase()))
        .map((d) => d.deliveryDate);

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        orderDate: order.orderDate,
        expectedDeliveryDate: order.expectedDeliveryDate,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        grandTotal: round2(order.grandTotal),
        invoiced: round2(invoiced),
        paid: round2(paid),
        remaining: round2(Math.max(billed - paid, 0)),
        deliveryStatus: deliveryState(order, linkedDeliveries),
        deliveryDate: deliveredDates.length
          ? deliveredDates[deliveredDates.length - 1]
          : null,
        deliveryNumbers: linkedDeliveries.map((d) => d.deliveryNumber),
        invoiceNumbers: linkedInvoices.map((inv) => inv.invoiceNumber),
        itemCount: order.items?.length || 0,
        items: (order.items || []).map((item) => ({
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: round2(item.unitPrice),
          totalPrice: round2(item.totalPrice)
        }))
      };
    });

    // Receivable ledger for the period
    const ledger = [
      ...invoices.map((inv) => ({
        date: inv.invoiceDate,
        documentNumber: inv.invoiceNumber,
        documentType: "Invoice",
        description: `Sales Invoice #${inv.invoiceNumber}`,
        dueDate: inv.dueDate,
        debit: round2(inv.grandTotal),
        credit: 0,
        refId: inv.id
      })),
      ...payments.map((pay) => ({
        date: pay.paymentDate,
        documentNumber: pay.paymentNumber,
        documentType: "Payment",
        description: `Payment Received #${pay.paymentNumber} (${pay.paymentMethod || "Cash"})`,
        dueDate: null,
        debit: 0,
        credit: round2(pay.amount),
        refId: pay.id
      })),
      ...creditNotes.map((cn) => ({
        date: cn.date || cn.createdAt,
        documentNumber: cn.creditNumber,
        documentType: "Credit Note",
        description: `Credit Note #${cn.creditNumber}`,
        dueDate: null,
        debit: 0,
        credit: round2(cn.amount),
        refId: cn.id
      }))
    ].sort((a, b) => {
      // Statements group by day; invoices post before the payments that settle them.
      const dayA = new Date(a.date).toISOString().slice(0, 10);
      const dayB = new Date(b.date).toISOString().slice(0, 10);
      if (dayA !== dayB) return dayA < dayB ? -1 : 1;
      const rank = { Invoice: 0, "Credit Note": 1, Payment: 2 };
      const byRank = (rank[a.documentType] ?? 9) - (rank[b.documentType] ?? 9);
      if (byRank !== 0) return byRank;
      return new Date(a.date) - new Date(b.date);
    });

    let running = openingBalance;
    let totalInvoiced = 0;
    let totalReceived = 0;
    let totalCredits = 0;
    const ledgerRows = ledger.map((line) => {
      running += line.debit - line.credit;
      totalInvoiced += line.debit;
      totalReceived += line.credit;
      if (line.documentType === "Credit Note") totalCredits += line.credit;
      return { ...line, runningBalance: round2(running) };
    });

    const monthlyMap = new Map();
    for (const line of ledger) {
      const key = new Date(line.date).toISOString().slice(0, 7);
      if (!monthlyMap.has(key)) monthlyMap.set(key, { month: key, invoiced: 0, received: 0 });
      const bucket = monthlyMap.get(key);
      bucket.invoiced += line.debit;
      bucket.received += line.credit;
    }
    for (const order of orders) {
      const key = new Date(order.orderDate).toISOString().slice(0, 7);
      if (!monthlyMap.has(key)) monthlyMap.set(key, { month: key, invoiced: 0, received: 0 });
      monthlyMap.get(key).orders = (monthlyMap.get(key).orders || 0) + 1;
    }

    let topProducts = [];
    try {
      const grouped = await prisma.salesInvoiceItem.groupBy({
        by: ["productId", "productName", "sku"],
        where: {
          invoice: {
            customerId: id,
            companyId,
            isDeleted: false,
            invoiceStatus: { not: "Cancelled" },
            ...dayRange("invoiceDate", start, end)
          }
        },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { lineTotal: "desc" } },
        take: 10
      });
      topProducts = grouped.map((row) => ({
        productId: row.productId,
        name: row.productName,
        sku: row.sku,
        totalQuantity: round2(row._sum.quantity),
        totalValue: round2(row._sum.lineTotal)
      }));
    } catch (error) {
      console.error("Customer account product rollup skipped:", error.message);
    }

    const ordersValue = orderRows.reduce((sum, o) => sum + o.grandTotal, 0);
    const ordersPaid = orderRows.reduce((sum, o) => sum + o.paid, 0);
    const ordersRemaining = orderRows.reduce((sum, o) => sum + o.remaining, 0);
    const deliveredOrders = orderRows.filter((o) => o.deliveryStatus === "Delivered").length;
    const openDeliveries = deliveries.filter(
      (d) => !["delivered", "completed"].includes(String(d.deliveryStatus || "").toLowerCase())
    ).length;
    const creditLimit = customer.creditLimit || 0;

    const now = new Date();
    let totalOutstanding = 0;
    let overdueAmount = 0;
    let overdueInvoices = 0;
    for (const inv of allInvoices) {
      const balance = Math.max(
        Number(inv.outstanding) || 0,
        (Number(inv.grandTotal) || 0) - (Number(inv.paidAmount) || 0),
        0
      );
      if (balance <= 0.009) continue;
      totalOutstanding += balance;
      if (inv.dueDate && new Date(inv.dueDate) < now) {
        overdueAmount += balance;
        overdueInvoices += 1;
      }
    }
    totalOutstanding = round2(totalOutstanding);

    res.json({
      success: true,
      data: {
        customer: {
          id: customer.id,
          customerNumber: customer.customerNumber,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          companyName: customer.companyName,
          customerType: customer.customerType,
          taxId: customer.taxId,
          status: customer.status,
          territory: customer.territory,
          address: customer.address,
          shippingAddress: customer.shippingAddress,
          billingAddress: customer.billingAddress,
          notes: customer.notes,
          creditLimit,
          creditTerms: customer.creditTerms,
          creditDays: customer.creditDays,
          creditPolicy: customer.creditPolicy,
          loyaltyPoints: customer.loyaltyPoints,
          totalOrders: customer.totalOrders,
          totalSpent: customer.totalSpent,
          averageOrderValue: customer.averageOrderValue,
          outstandingBalance: customer.outstandingBalance,
          lastOrderDate: customer.lastOrderDate,
          salesperson: customer.salesperson
        },
        company: {
          id: customer.company?.id || null,
          name: customer.company?.name || "",
          address: customer.company?.address || "",
          phone: customer.company?.phone || "",
          email: customer.company?.email || "",
          logo: customer.company?.logo || "",
          currencyCode: customer.company?.baseCurrency?.code || "PKR",
          currencySymbol: customer.company?.baseCurrency?.symbol || "Rs."
        },
        period: { from: start, to: end },
        summary: {
          openingBalance: round2(openingBalance),
          totalInvoiced: round2(totalInvoiced),
          totalReceived: round2(totalReceived),
          totalCredits: round2(totalCredits),
          closingBalance: round2(openingBalance + totalInvoiced - totalReceived),
          totalOutstanding,
          overdueAmount: round2(overdueAmount),
          overdueInvoices,
          invoiceCount: allInvoices.length,
          periodInvoiceCount: invoices.length,
          paymentCount: payments.length,
          creditNoteCount: creditNotes.length,
          creditLimit,
          availableCredit: creditLimit > 0 ? round2(Math.max(creditLimit - totalOutstanding, 0)) : 0,
          ordersCount: orderRows.length,
          ordersValue: round2(ordersValue),
          ordersPaid: round2(ordersPaid),
          ordersRemaining: round2(ordersRemaining),
          deliveredOrders,
          undeliveredOrders: orderRows.length - deliveredOrders,
          deliveriesCount: deliveries.length,
          openDeliveries
        },
        orders: orderRows,
        deliveries: deliveries.map((d) => ({
          id: d.id,
          deliveryNumber: d.deliveryNumber,
          salesOrderNumber: d.salesOrderNumber,
          deliveryDate: d.deliveryDate,
          deliveryStatus: d.deliveryStatus,
          deliveryPerson: d.deliveryPerson,
          trackingNumber: d.trackingNumber,
          notes: d.notes,
          orderedQuantity: round2((d.items || []).reduce((sum, i) => sum + (i.orderedQuantity || 0), 0)),
          deliveredQuantity: round2((d.items || []).reduce((sum, i) => sum + (i.deliveredQuantity || 0), 0)),
          items: (d.items || []).map((item) => ({
            productName: item.productName,
            sku: item.sku,
            unit: item.unit,
            orderedQuantity: item.orderedQuantity,
            deliveredQuantity: item.deliveredQuantity,
            remainingQuantity: item.remainingQuantity
          }))
        })),
        invoices: invoices.map((inv) => {
          const balance = Math.max(
            Number(inv.outstanding) || 0,
            (Number(inv.grandTotal) || 0) - (Number(inv.paidAmount) || 0),
            0
          );
          return {
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            orderNumber: inv.orderNumber,
            invoiceDate: inv.invoiceDate,
            dueDate: inv.dueDate,
            grandTotal: round2(inv.grandTotal),
            paidAmount: round2(inv.paidAmount),
            outstanding: round2(balance),
            invoiceStatus: inv.invoiceStatus,
            paymentStatus: inv.paymentStatus,
            isOverdue: balance > 0 && inv.dueDate && new Date(inv.dueDate) < new Date()
          };
        }),
        payments: payments.map((pay) => ({
          id: pay.id,
          paymentNumber: pay.paymentNumber,
          paymentDate: pay.paymentDate,
          amount: round2(pay.amount),
          paymentMethod: pay.paymentMethod,
          reference: pay.reference,
          notes: pay.notes,
          status: pay.status,
          bankAccountName: pay.bankAccountName
        })),
        creditNotes: creditNotes.map((cn) => ({
          id: cn.id,
          creditNumber: cn.creditNumber,
          date: cn.date,
          amount: round2(cn.amount),
          remainingAmount: round2(cn.remainingAmount),
          status: cn.status,
          reason: cn.reason
        })),
        ledger: ledgerRows,
        monthly: Array.from(monthlyMap.values())
          .sort((a, b) => a.month.localeCompare(b.month))
          .map((row) => ({
            month: row.month,
            invoiced: round2(row.invoiced),
            received: round2(row.received),
            orders: row.orders || 0
          })),
        topProducts
      }
    });
  } catch (error) {
    console.error("Error in getCustomerAccount:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCustomerLedger = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { startDate, endDate, page = 1, limit = 50 } = req.query;
    const start = dayStart(startDate);
    const end = dayEnd(endDate);

    const customer = await prisma.customer.findFirst({
      where: { id, companyId, isDeleted: false },
      include: { company: { select: { baseCurrency: { select: { code: true } } } } }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const currency = customer.company?.baseCurrency?.code || "PKR";
    const invoiceScope = {
      customerId: id,
      companyId,
      isDeleted: false,
      invoiceStatus: { not: "Cancelled" }
    };

    const [invoices, payments, creditNotes] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: { ...invoiceScope, ...dayRange("invoiceDate", start, end) },
        orderBy: { invoiceDate: "asc" }
      }),
      prisma.salesPaymentReceived.findMany({
        where: { customerId: id, companyId, isDeleted: false, ...dayRange("paymentDate", start, end) },
        orderBy: { paymentDate: "asc" }
      }),
      prisma.creditNote.findMany({
        where: { customerId: id, companyId, ...dayRange("date", start, end) },
        orderBy: { date: "asc" }
      })
    ]);

    let openingBalance = 0;
    if (start) {
      const [priorInvoices, priorPayments, priorCredits] = await Promise.all([
        prisma.salesInvoice.aggregate({
          where: { ...invoiceScope, invoiceDate: { lt: start } },
          _sum: { grandTotal: true }
        }),
        prisma.salesPaymentReceived.aggregate({
          where: { customerId: id, companyId, isDeleted: false, paymentDate: { lt: start } },
          _sum: { amount: true }
        }),
        prisma.creditNote.aggregate({
          where: { customerId: id, companyId, date: { lt: start } },
          _sum: { amount: true }
        })
      ]);
      openingBalance =
        (priorInvoices._sum.grandTotal || 0) -
        (priorPayments._sum.amount || 0) -
        (priorCredits._sum.amount || 0);
    }

    const ledgerLines = [];

    invoices.forEach((inv) => {
      ledgerLines.push({
        id: inv.id,
        date: inv.invoiceDate,
        documentNumber: inv.invoiceNumber,
        documentType: "Invoice",
        description: `Sales Invoice #${inv.invoiceNumber}`,
        dueDate: inv.dueDate,
        currency,
        debit: inv.grandTotal || 0,
        credit: 0,
        refId: inv.id
      });
    });

    payments.forEach((p) => {
      ledgerLines.push({
        id: p.id,
        date: p.paymentDate,
        documentNumber: p.paymentNumber,
        documentType: "Payment",
        description: `Payment Received #${p.paymentNumber} (${p.paymentMethod || "Cash"})`,
        dueDate: null,
        currency,
        debit: 0,
        credit: p.amount || 0,
        refId: p.id
      });
    });

    creditNotes.forEach((cn) => {
      ledgerLines.push({
        id: cn.id,
        date: cn.date || cn.createdAt,
        documentNumber: cn.creditNumber || "CN",
        documentType: "Credit Note",
        description: `Credit Note #${cn.creditNumber || ""}`,
        dueDate: null,
        currency,
        debit: 0,
        credit: cn.amount || 0,
        refId: cn.id
      });
    });

    ledgerLines.sort((a, b) => {
      const dayA = new Date(a.date).toISOString().slice(0, 10);
      const dayB = new Date(b.date).toISOString().slice(0, 10);
      if (dayA !== dayB) return dayA < dayB ? -1 : 1;
      const rank = { Invoice: 0, "Credit Note": 1, Payment: 2 };
      const byRank = (rank[a.documentType] ?? 9) - (rank[b.documentType] ?? 9);
      if (byRank !== 0) return byRank;
      return new Date(a.date) - new Date(b.date);
    });

    let runningBalance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;

    const formattedLines = ledgerLines.map((line) => {
      runningBalance += line.debit - line.credit;
      totalDebit += line.debit;
      totalCredit += line.credit;
      return { ...line, runningBalance: round2(runningBalance) };
    });

    const p = Math.max(parseInt(page) || 1, 1);
    const l = Math.max(parseInt(limit) || 50, 1);
    const paginatedLines = formattedLines.slice((p - 1) * l, p * l);

    res.json({
      success: true,
      data: {
        customer: { id: customer.id, name: customer.name, customerNumber: customer.customerNumber },
        summary: {
          openingBalance: round2(openingBalance),
          totalDebit: round2(totalDebit),
          totalCredit: round2(totalCredit),
          closingBalance: round2(runningBalance)
        },
        pagination: {
          total: formattedLines.length,
          page: p,
          limit: l,
          pages: Math.ceil(formattedLines.length / l)
        },
        lines: paginatedLines
      }
    });
  } catch (error) {
    console.error("Error in getCustomerLedger:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCustomerStatement = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const customer = await prisma.customer.findFirst({
      where: { id, companyId, isDeleted: false },
      include: { company: { include: { baseCurrency: { select: { code: true } } } } }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const start = dayStart(startDate) || new Date(new Date().getFullYear(), 0, 1);
    const end = dayEnd(endDate) || new Date();
    const currency = customer.company?.baseCurrency?.code || "PKR";
    const invoiceScope = {
      customerId: id,
      companyId,
      isDeleted: false,
      invoiceStatus: { not: "Cancelled" }
    };

    // Opening Balance before start date
    const [priorInvoices, priorPayments, priorCredits] = await Promise.all([
      prisma.salesInvoice.aggregate({
        where: { ...invoiceScope, invoiceDate: { lt: start } },
        _sum: { grandTotal: true }
      }),
      prisma.salesPaymentReceived.aggregate({
        where: { customerId: id, companyId, isDeleted: false, paymentDate: { lt: start } },
        _sum: { amount: true }
      }),
      prisma.creditNote.aggregate({
        where: { customerId: id, companyId, date: { lt: start } },
        _sum: { amount: true }
      })
    ]);
    const openingBalance =
      (priorInvoices._sum.grandTotal || 0) -
      (priorPayments._sum.amount || 0) -
      (priorCredits._sum.amount || 0);

    // Period Invoices / Payments / Credit Notes
    const [periodInvoices, periodPayments, periodCredits] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: { ...invoiceScope, invoiceDate: { gte: start, lte: end } },
        orderBy: { invoiceDate: "asc" }
      }),
      prisma.salesPaymentReceived.findMany({
        where: {
          customerId: id,
          companyId,
          isDeleted: false,
          paymentDate: { gte: start, lte: end }
        },
        orderBy: { paymentDate: "asc" }
      }),
      prisma.creditNote.findMany({
        where: { customerId: id, companyId, date: { gte: start, lte: end } },
        orderBy: { date: "asc" }
      })
    ]);

    const transactions = [];

    periodInvoices.forEach((inv) => {
      transactions.push({
        date: inv.invoiceDate,
        documentNo: inv.invoiceNumber,
        type: "Invoice",
        description: `Sales Invoice #${inv.invoiceNumber}`,
        debit: inv.grandTotal,
        credit: 0,
        currency
      });
    });

    periodPayments.forEach((pay) => {
      transactions.push({
        date: pay.paymentDate,
        documentNo: pay.paymentNumber,
        type: "Payment",
        description: `Payment Received #${pay.paymentNumber}`,
        debit: 0,
        credit: pay.amount,
        currency
      });
    });

    periodCredits.forEach((cn) => {
      transactions.push({
        date: cn.date || cn.createdAt,
        documentNo: cn.creditNumber,
        type: "Credit Note",
        description: `Credit Note #${cn.creditNumber}`,
        debit: 0,
        credit: cn.amount,
        currency
      });
    });

    transactions.sort((a, b) => {
      const dayA = new Date(a.date).toISOString().slice(0, 10);
      const dayB = new Date(b.date).toISOString().slice(0, 10);
      if (dayA !== dayB) return dayA < dayB ? -1 : 1;
      const rank = { Invoice: 0, "Credit Note": 1, Payment: 2 };
      const byRank = (rank[a.type] ?? 9) - (rank[b.type] ?? 9);
      if (byRank !== 0) return byRank;
      return new Date(a.date) - new Date(b.date);
    });

    let balance = openingBalance;
    let totalInvoiced = 0;
    let totalReceived = 0;

    const statementLines = transactions.map((t) => {
      balance += t.debit - t.credit;
      totalInvoiced += t.debit;
      totalReceived += t.credit;
      return {
        ...t,
        runningBalance: round2(balance)
      };
    });

    res.json({
      success: true,
      data: {
        company: customer.company,
        customer,
        statementPeriod: { startDate: start, endDate: end },
        openingBalance: round2(openingBalance),
        totalInvoiced: round2(totalInvoiced),
        totalReceived: round2(totalReceived),
        closingBalance: round2(balance),
        lines: statementLines
      }
    });
  } catch (error) {
    console.error("Error in getCustomerStatement:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// -------------------------------------------------------------
// 4. COLLECTIONS & RECOVERY WORKSPACE
// -------------------------------------------------------------
exports.getCollectionsWorkspace = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { salespersonId, territory, statusFilter = "ALL" } = req.query;

    const customers = await prisma.customer.findMany({
      where: {
        companyId,
        isActive: true,
        ...(salespersonId && { salespersonId }),
        ...(territory && { territory: { contains: territory, mode: "insensitive" } })
      },
      include: {
        salesperson: { select: { id: true, name: true, phone: true } }
      }
    });

    const now = new Date();
    const collectionsList = [];

    for (const cust of customers) {
      const invoices = await prisma.salesInvoice.findMany({
        where: { customerId: cust.id, companyId, outstanding: { gt: 0 }, status: { not: "Cancelled" } },
        orderBy: { dueDate: "asc" }
      });

      if (invoices.length === 0 && statusFilter === "OVERDUE_ONLY") continue;

      const totalOutstanding = invoices.reduce((sum, inv) => sum + (inv.outstanding || 0), 0);
      const overdueInvoices = invoices.filter(inv => inv.dueDate && new Date(inv.dueDate) < now);
      const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + (inv.outstanding || 0), 0);

      let maxOverdueDays = 0;
      if (overdueInvoices.length > 0) {
        const oldestDue = new Date(overdueInvoices[0].dueDate);
        maxOverdueDays = Math.floor((now - oldestDue) / (1000 * 60 * 60 * 24));
      }

      const creditUtil = cust.creditLimit > 0 ? Math.round((totalOutstanding / cust.creditLimit) * 100) : 0;

      const lastPayment = await prisma.salesPaymentReceived.findFirst({
        where: { customerId: cust.id, companyId },
        orderBy: { paymentDate: "desc" }
      });

      if (statusFilter === "OVERDUE_ONLY" && overdueAmount === 0) continue;
      if (statusFilter === "OVER_LIMIT" && totalOutstanding <= cust.creditLimit) continue;

      collectionsList.push({
        id: cust.id,
        customerNumber: cust.customerNumber,
        name: cust.name,
        phone: cust.phone,
        territory: cust.territory || "Unassigned",
        salesperson: cust.salesperson?.name || "Unassigned",
        salespersonId: cust.salespersonId,
        creditLimit: cust.creditLimit,
        creditPolicy: cust.creditPolicy || "WARN",
        creditDays: cust.creditDays || 30,
        totalOutstanding,
        overdueAmount,
        maxOverdueDays,
        creditUtil,
        openInvoiceCount: invoices.length,
        lastPaymentDate: lastPayment ? lastPayment.paymentDate : null,
        lastPaymentAmount: lastPayment ? lastPayment.amount : 0
      });
    }

    collectionsList.sort((a, b) => b.overdueAmount - a.overdueAmount);

    const summary = {
      totalCustomers: collectionsList.length,
      totalOutstanding: collectionsList.reduce((sum, c) => sum + c.totalOutstanding, 0),
      totalOverdue: collectionsList.reduce((sum, c) => sum + c.overdueAmount, 0),
      overLimitCount: collectionsList.filter(c => c.creditLimit > 0 && c.totalOutstanding > c.creditLimit).length
    };

    res.json({ success: true, summary, data: collectionsList });
  } catch (error) {
    console.error("Error in getCollectionsWorkspace:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// -------------------------------------------------------------
// 5. AGING & REPORTING ENGINE
// -------------------------------------------------------------
exports.getCustomerAgingReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { salespersonId, locationId } = req.query;

    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        outstanding: { gt: 0 },
        status: { not: "Cancelled" },
        ...(salespersonId && { salespersonId }),
        ...(locationId && { locationId })
      },
      include: {
        customer: { select: { id: true, customerNumber: true, name: true, phone: true, territory: true } },
        salesperson: { select: { id: true, name: true } }
      }
    });

    const now = new Date();
    const customerMap = new Map();

    invoices.forEach(inv => {
      const cid = inv.customerId;
      if (!customerMap.has(cid)) {
        customerMap.set(cid, {
          customerId: cid,
          customerNumber: inv.customer?.customerNumber || "",
          customerName: inv.customer?.name || "Unknown",
          territory: inv.customer?.territory || "-",
          salespersonName: inv.salesperson?.name || "-",
          totalOutstanding: 0,
          current: 0,
          days1_30: 0,
          days31_60: 0,
          days61_90: 0,
          days90Plus: 0
        });
      }

      const rec = customerMap.get(cid);
      const outstanding = inv.outstanding || 0;
      rec.totalOutstanding += outstanding;

      const dueDate = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.invoiceDate);
      const diffTime = now - dueDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        rec.current += outstanding;
      } else if (diffDays <= 30) {
        rec.days1_30 += outstanding;
      } else if (diffDays <= 60) {
        rec.days31_60 += outstanding;
      } else if (diffDays <= 90) {
        rec.days61_90 += outstanding;
      } else {
        rec.days90Plus += outstanding;
      }
    });

    const agingData = Array.from(customerMap.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);

    const totals = agingData.reduce(
      (acc, curr) => {
        acc.totalOutstanding += curr.totalOutstanding;
        acc.current += curr.current;
        acc.days1_30 += curr.days1_30;
        acc.days31_60 += curr.days31_60;
        acc.days61_90 += curr.days61_90;
        acc.days90Plus += curr.days90Plus;
        return acc;
      },
      { totalOutstanding: 0, current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days90Plus: 0 }
    );

    res.json({ success: true, totals, data: agingData });
  } catch (error) {
    console.error("Error in getCustomerAgingReport:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSalespersonRecoveryReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { startDate, endDate } = req.query;

    const salespersons = await prisma.salesperson.findMany({
      where: { companyId },
      include: { location: { select: { id: true, name: true } } }
    });

    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const report = await Promise.all(
      salespersons.map(async sp => {
        const invoices = await prisma.salesInvoice.findMany({
          where: {
            salespersonId: sp.id,
            companyId,
            ...(Object.keys(dateFilter).length > 0 && { invoiceDate: dateFilter })
          }
        });

        const totalSales = invoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
        const totalRecovery = invoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
        const totalOutstanding = invoices.reduce((sum, inv) => sum + (inv.outstanding || 0), 0);

        const targetAchievement = sp.monthlyTarget > 0 ? (totalSales / sp.monthlyTarget) * 100 : 0;

        return {
          salespersonId: sp.id,
          salespersonNumber: sp.salespersonNumber,
          name: sp.name,
          territory: sp.territory || "-",
          monthlyTarget: sp.monthlyTarget,
          totalSales,
          totalRecovery,
          totalOutstanding,
          targetAchievement: Math.round(targetAchievement * 10) / 10
        };
      })
    );

    res.json({ success: true, data: report });
  } catch (error) {
    console.error("Error in getSalespersonRecoveryReport:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// -------------------------------------------------------------
// 6. PRODUCT & WAREHOUSE 360 ANALYTICS
// -------------------------------------------------------------
exports.getProductDistributorAnalytics = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const product = await prisma.product.findFirst({
      where: { id, companyId },
      include: { category: { select: { id: true, name: true } } }
    });

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const productStocks = await prisma.productStock.findMany({
      where: { productId: id, companyId },
      include: { location: { select: { id: true, name: true } } }
    });

    const salesItems = await prisma.salesInvoiceItem.findMany({
      where: { productId: id, invoice: { companyId } },
      include: { invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true, customer: { select: { name: true } } } } },
      take: 100
    });

    const totalSoldQty = salesItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
    const totalSalesValue = salesItems.reduce((sum, item) => sum + (item.total || 0), 0);

    const writeOffItems = await prisma.stockWriteOffItem.findMany({
      where: { productId: id, stockWriteOff: { companyId } },
      include: { stockWriteOff: { select: { writeOffNumber: true, writeOffDate: true, reason: true } } }
    });

    const totalWrittenOffQty = writeOffItems.reduce((sum, item) => sum + (item.quantity || 0), 0);

    const cost = product.costPrice || 0;
    const price = product.sellingPrice || 0;
    const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;

    res.json({
      success: true,
      data: {
        product: {
          ...product,
          marginPercent: margin,
          unitProfit: price - cost
        },
        stocks: productStocks,
        totalSoldQty,
        totalSalesValue,
        totalWrittenOffQty,
        recentSales: salesItems,
        recentWriteOffs: writeOffItems
      }
    });
  } catch (error) {
    console.error("Error in getProductDistributorAnalytics:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getWarehouse360 = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { locationId } = req.params;

    const location = await prisma.location.findFirst({
      where: { id: locationId, companyId }
    });

    if (!location) {
      return res.status(404).json({ success: false, message: "Warehouse / Location not found" });
    }

    const stocks = await prisma.productStock.findMany({
      where: { locationId, companyId },
      include: { product: { select: { id: true, name: true, sku: true, costPrice: true, sellingPrice: true } } }
    });

    let totalStockValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    stocks.forEach(st => {
      const qty = st.quantity || 0;
      const cost = st.product?.costPrice || 0;
      totalStockValuation += qty * cost;
      if (qty <= 0) outOfStockCount++;
      else if (st.minStockLevel && qty <= st.minStockLevel) lowStockCount++;
    });

    const writeOffs = await prisma.stockWriteOff.findMany({
      where: { locationId, companyId },
      take: 20,
      orderBy: { writeOffDate: "desc" }
    });

    res.json({
      success: true,
      data: {
        location,
        summary: {
          totalProducts: stocks.length,
          totalStockValuation,
          lowStockCount,
          outOfStockCount,
          totalWriteOffs: writeOffs.length
        },
        stocks,
        recentWriteOffs: writeOffs
      }
    });
  } catch (error) {
    console.error("Error in getWarehouse360:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// -------------------------------------------------------------
// 7. DISTRIBUTOR MAIN DASHBOARD
// -------------------------------------------------------------
exports.getDistributorDashboard = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Sales Aggregations
    const salesToday = await prisma.salesInvoice.aggregate({
      where: { companyId, invoiceDate: { gte: startOfToday }, status: { not: "Cancelled" } },
      _sum: { grandTotal: true },
      _count: { _all: true }
    });

    const salesMonth = await prisma.salesInvoice.aggregate({
      where: { companyId, invoiceDate: { gte: startOfMonth }, status: { not: "Cancelled" } },
      _sum: { grandTotal: true },
      _count: { _all: true }
    });

    // Recovery Aggregations
    const recoveryToday = await prisma.salesPaymentReceived.aggregate({
      where: { companyId, paymentDate: { gte: startOfToday } },
      _sum: { amount: true }
    });

    const recoveryMonth = await prisma.salesPaymentReceived.aggregate({
      where: { companyId, paymentDate: { gte: startOfMonth } },
      _sum: { amount: true }
    });

    // Receivables Aggregations
    const outstandingAgg = await prisma.salesInvoice.aggregate({
      where: { companyId, outstanding: { gt: 0 }, status: { not: "Cancelled" } },
      _sum: { outstanding: true },
      _count: { _all: true }
    });

    const now = new Date();
    const overdueAgg = await prisma.salesInvoice.aggregate({
      where: { companyId, outstanding: { gt: 0 }, dueDate: { lt: now }, status: { not: "Cancelled" } },
      _sum: { outstanding: true },
      _count: { _all: true }
    });

    // Customers Over Limit
    const customersOverLimit = await prisma.customer.count({
      where: { companyId, creditLimit: { gt: 0 }, outstandingBalance: { gt: prisma.customer.fields.creditLimit } }
    });

    // Stock Valuation & Alerts
    const products = await prisma.product.findMany({
      where: { companyId, isDeleted: false },
      select: { id: true, costPrice: true, reorderPoint: true }
    });

    const lowStockCount = await prisma.productStock.count({
      where: { companyId, quantity: { lte: 5 } }
    });

    // Top Salespersons
    const topSalespersons = await prisma.salesperson.findMany({
      where: { companyId, status: "Active" },
      take: 5
    });

    const salespersonPerformance = await Promise.all(
      topSalespersons.map(async sp => {
        const invAgg = await prisma.salesInvoice.aggregate({
          where: { salespersonId: sp.id, companyId, invoiceDate: { gte: startOfMonth } },
          _sum: { grandTotal: true, paidAmount: true }
        });
        return {
          id: sp.id,
          name: sp.name,
          territory: sp.territory || "-",
          monthlySales: invAgg._sum.grandTotal || 0,
          monthlyRecovery: invAgg._sum.paidAmount || 0,
          target: sp.monthlyTarget || 0,
          achievementPercent: sp.monthlyTarget > 0 ? Math.round(((invAgg._sum.grandTotal || 0) / sp.monthlyTarget) * 100) : 0
        };
      })
    );

    res.json({
      success: true,
      data: {
        sales: {
          todayAmount: salesToday._sum.grandTotal || 0,
          todayCount: salesToday._count._all || 0,
          monthAmount: salesMonth._sum.grandTotal || 0,
          monthCount: salesMonth._count._all || 0
        },
        recovery: {
          todayAmount: recoveryToday._sum.amount || 0,
          monthAmount: recoveryMonth._sum.amount || 0
        },
        receivables: {
          totalOutstanding: outstandingAgg._sum.outstanding || 0,
          openInvoicesCount: outstandingAgg._count._all || 0,
          overdueAmount: overdueAgg._sum.outstanding || 0,
          overdueCount: overdueAgg._count._all || 0,
          customersOverLimitCount: customersOverLimit
        },
        inventory: {
          totalProductsCount: products.length,
          lowStockCount
        },
        topSalespersons: salespersonPerformance
      }
    });
  } catch (error) {
    console.error("Error in getDistributorDashboard:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
