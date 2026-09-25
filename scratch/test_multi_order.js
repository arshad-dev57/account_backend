const prisma = require('../prisma/client');
const Delivery = require('../warehouse/models/Delivery');
const { adjustLocationStock } = require('../warehouse/services/locationService');

async function testMultiOrderDelivery() {
  console.log('--- STARTING MULTI-ORDER DELIVERY TEST ---');

  try {
    const customer = await prisma.customer.findFirst();
    const product = await prisma.product.findFirst();
    const location = await prisma.location.findFirst();
    const realUser = await prisma.user.findFirst();
    const testUserId = realUser?.id;

    if (!customer || !product || !location) {
      console.error('Customer, product, or location not found in DB');
      return;
    }

    const companyId = location.companyId;

    // Add stock for test
    await adjustLocationStock(prisma, {
      companyId: companyId,
      productId: product.id,
      locationId: location.id,
      delta: 100,
      reservedDelta: 0,
      productName: product.name
    });

    // Create 2 fresh Sales Orders for this customer
    const timestamp = Date.now().toString().slice(-4);
    const order1 = await prisma.order.create({
      data: {
        orderNumber: `SO-FRESH-1-${timestamp}`,
        orderType: 'Sales Order',
        orderStatus: 'Confirmed',
        customerName: customer.name,
        company: companyId ? { connect: { id: companyId } } : undefined,
        customer: { connect: { id: customer.id } },
        creator: testUserId ? { connect: { id: testUserId } } : undefined,
        location: { connect: { id: location.id } },
        subtotal: 100,
        taxTotal: 0,
        discountTotal: 0,
        grandTotal: 100,
        items: {
          create: [{
            product: { connect: { id: product.id } },
            productName: product.name,
            sku: product.sku,
            quantity: 5,
            unitPrice: 20,
            totalPrice: 100
          }]
        }
      },
      include: { items: true }
    });

    const order2 = await prisma.order.create({
      data: {
        orderNumber: `SO-FRESH-2-${timestamp}`,
        orderType: 'Sales Order',
        orderStatus: 'Confirmed',
        customerName: customer.name,
        company: companyId ? { connect: { id: companyId } } : undefined,
        customer: { connect: { id: customer.id } },
        creator: testUserId ? { connect: { id: testUserId } } : undefined,
        location: { connect: { id: location.id } },
        subtotal: 100,
        taxTotal: 0,
        discountTotal: 0,
        grandTotal: 100,
        items: {
          create: [{
            product: { connect: { id: product.id } },
            productName: product.name,
            sku: product.sku,
            quantity: 5,
            unitPrice: 20,
            totalPrice: 100
          }]
        }
      },
      include: { items: true }
    });

    console.log(`Created fresh orders: ${order1.orderNumber} & ${order2.orderNumber} for customer: ${customer.name}`);

    // Create single delivery for BOTH orders
    const deliveryData = {
      salesOrderIds: [order1.id, order2.id],
      deliveryDate: new Date().toISOString(),
      deliveryPerson: 'Multi-Order Delivery Driver',
      trackingNumber: 'TRK-FRESH-123',
      notes: 'Testing fresh multi-order delivery batch',
      createdBy: testUserId,
      companyId: companyId,
      locationId: location.id,
      items: [
        {
          orderId: order1.id,
          productId: product.id,
          deliveredQuantity: 5
        },
        {
          orderId: order2.id,
          productId: product.id,
          deliveredQuantity: 5
        }
      ]
    };

    const delivery = await Delivery.createMultiOrder(deliveryData);
    console.log(`Successfully created single delivery: ${delivery.deliveryNumber} for orders: ${delivery.salesOrderNumber}`);
    console.log(`Delivery ID: ${delivery.id}, Items count: ${delivery.items.length}`);

    // Confirm delivery
    console.log('Confirming delivery...');
    const confirmed = await Delivery.confirmDelivery(delivery.id, testUserId);
    console.log(`Delivery confirmed! Status: ${confirmed.deliveryStatus}`);

    // Check order statuses for BOTH orders
    const updatedOrder1 = await prisma.order.findUnique({ where: { id: order1.id } });
    const updatedOrder2 = await prisma.order.findUnique({ where: { id: order2.id } });

    console.log(`Order 1 (${updatedOrder1.orderNumber}) Status: ${updatedOrder1.orderStatus}`);
    console.log(`Order 2 (${updatedOrder2.orderNumber}) Status: ${updatedOrder2.orderStatus}`);

    if (updatedOrder1.orderStatus === 'Delivered' && updatedOrder2.orderStatus === 'Delivered') {
      console.log('🎉 SUCCESS: Both orders successfully updated to Delivered from a SINGLE delivery note!');
    } else {
      console.error('❌ FAIL: Order statuses not updated correctly.');
    }

  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testMultiOrderDelivery();
