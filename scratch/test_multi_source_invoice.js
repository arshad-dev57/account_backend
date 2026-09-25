const prisma = require('../prisma/client');
const SalesInvoice = require('../warehouse/models/SalesInvoice');
const { adjustLocationStock } = require('../warehouse/services/locationService');

async function testMultiSourceInvoice() {
  console.log('--- STARTING MULTI-SOURCE INVOICE TEST ---');

  try {
    const customer = await prisma.customer.findFirst();
    const product = await prisma.product.findFirst();
    const location = await prisma.location.findFirst();
    const realUser = await prisma.user.findFirst();
    const testUserId = realUser?.id;

    if (!customer || !product || !location) {
      console.error('Customer, product, or location not found');
      return;
    }

    const companyId = location.companyId;

    // Adjust stock for testing
    await adjustLocationStock(prisma, {
      companyId: companyId,
      productId: product.id,
      locationId: location.id,
      delta: 100,
      reservedDelta: 0,
      productName: product.name
    });

    // Create 2 fresh Sales Orders for this customer without any deliveries
    const timestamp = Date.now().toString().slice(-4);
    const order1 = await prisma.order.create({
      data: {
        orderNumber: `SO-INV-1-${timestamp}`,
        orderType: 'Sales Order',
        orderStatus: 'Confirmed',
        customerName: customer.name,
        company: companyId ? { connect: { id: companyId } } : undefined,
        customer: { connect: { id: customer.id } },
        creator: testUserId ? { connect: { id: testUserId } } : undefined,
        location: { connect: { id: location.id } },
        subtotal: 200,
        taxTotal: 0,
        discountTotal: 0,
        grandTotal: 200,
        items: {
          create: [{
            product: { connect: { id: product.id } },
            productName: product.name,
            sku: product.sku,
            quantity: 2,
            unitPrice: 100,
            totalPrice: 200
          }]
        }
      },
      include: { items: true }
    });

    const order2 = await prisma.order.create({
      data: {
        orderNumber: `SO-INV-2-${timestamp}`,
        orderType: 'Sales Order',
        orderStatus: 'Confirmed',
        customerName: customer.name,
        company: companyId ? { connect: { id: companyId } } : undefined,
        customer: { connect: { id: customer.id } },
        creator: testUserId ? { connect: { id: testUserId } } : undefined,
        location: { connect: { id: location.id } },
        subtotal: 300,
        taxTotal: 0,
        discountTotal: 0,
        grandTotal: 300,
        items: {
          create: [{
            product: { connect: { id: product.id } },
            productName: product.name,
            sku: product.sku,
            quantity: 3,
            unitPrice: 100,
            totalPrice: 300
          }]
        }
      },
      include: { items: true }
    });

    console.log(`Created test orders: ${order1.orderNumber} & ${order2.orderNumber} for customer: ${customer.name}`);

    // Call SalesInvoice.createMultiSource
    const invoiceData = {
      orderIds: [order1.id, order2.id],
      deliveryIds: [],
      items: [
        {
          orderId: order1.id,
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: 2,
          unitPrice: 100,
          discount: 0,
          taxRate: 0
        },
        {
          orderId: order2.id,
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: 3,
          unitPrice: 100,
          discount: 0,
          taxRate: 0
        }
      ],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      paymentTerms: 'Net 30',
      notes: 'Testing multi-source invoice auto-delivery',
      userId: testUserId,
      companyId: companyId,
      locationId: location.id
    };

    const invoice = await SalesInvoice.createMultiSource(invoiceData);
    console.log(`Successfully created Sales Invoice: ${invoice.invoiceNumber}`);
    console.log(`Linked Orders: ${invoice.orderNumber}`);
    console.log(`Linked Deliveries (Auto-Created): ${invoice.deliveryNumber}`);
    console.log(`Invoice Grand Total: $${invoice.grandTotal}`);

    // Check order statuses
    const updatedOrder1 = await prisma.order.findUnique({ where: { id: order1.id } });
    const updatedOrder2 = await prisma.order.findUnique({ where: { id: order2.id } });

    console.log(`Order 1 (${updatedOrder1.orderNumber}) status: ${updatedOrder1.orderStatus}`);
    console.log(`Order 2 (${updatedOrder2.orderNumber}) status: ${updatedOrder2.orderStatus}`);

    if (updatedOrder1.orderStatus === 'Delivered' && updatedOrder2.orderStatus === 'Delivered') {
      console.log('🎉 SUCCESS: Auto-delivery confirmed & both orders updated to Delivered!');
    } else {
      console.log('Order status update check result:', updatedOrder1.orderStatus, updatedOrder2.orderStatus);
    }

  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testMultiSourceInvoice();
