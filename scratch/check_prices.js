const prisma = require('../prisma/client');

async function checkDeliveries() {
  const deliveries = await prisma.delivery.findMany({
    take: 5,
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, sellingPrice: true } }
        }
      },
      salesOrder: { include: { items: true } }
    }
  });

  console.log('Found deliveries:', deliveries.length);
  deliveries.forEach(d => {
    console.log('Delivery:', d.deliveryNumber);
    d.items.forEach(i => {
      const orderItem = d.salesOrder?.items?.find(oi => oi.productId === i.productId);
      const unitPrice = orderItem?.unitPrice != null
        ? Number(orderItem.unitPrice)
        : (i.product?.sellingPrice != null ? Number(i.product.sellingPrice) : 0);
      console.log('  Item:', i.productName, '| Qty:', i.deliveredQuantity, '| Resolved Unit Price:', unitPrice);
    });
  });
  await prisma.$disconnect();
}

checkDeliveries();
