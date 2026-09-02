const { sendToUser } = require('../../services/notificationService');
const prisma = require('../../prisma/client');

function ticketLabel(order) {
  const n = order.ticketNumber ? `#${order.ticketNumber}` : 'Order';
  const table = order.tableLabel ? ` · Table ${order.tableLabel}` : '';
  return `${n}${table}`;
}

async function notifyWaiter(order, { title, message, status, type = 'info' }) {
  if (!order?.waiterUserId) return;
  try {
    await sendToUser({
      mongoUserId: order.waiterUserId,
      title,
      message,
      type,
      category: 'Restaurant',
      collapseId: `rest-order-${order.id}-${status}`,
      data: {
        type: 'restaurant_order',
        orderId: order.id,
        status,
        ticketNumber: order.ticketNumber,
        tableLabel: order.tableLabel,
        screen: 'orders',
        app: 'order_picker',
      },
    });
  } catch (err) {
    console.error('[RestaurantNotify] waiter push failed:', err.message);
  }
}

async function notifyKitchenStaff(companyId, order, { title, message }) {
  if (!companyId) return;
  try {
    const staff = await prisma.user.findMany({
      where: {
        companyId,
        role: { equals: 'kitchen', mode: 'insensitive' },
      },
      select: { id: true },
    });
    await Promise.all(
      staff.map((u) =>
        sendToUser({
          mongoUserId: u.id,
          title,
          message,
          type: 'info',
          category: 'Restaurant',
          collapseId: `rest-kitchen-${order.id}`,
          data: {
            type: 'restaurant_order',
            orderId: order.id,
            status: 'SENT',
            ticketNumber: order.ticketNumber,
            tableLabel: order.tableLabel,
            screen: 'kitchen',
            app: 'kitchen',
          },
        }).catch((e) => console.error('[RestaurantNotify] kitchen push:', e.message))
      )
    );
  } catch (err) {
    console.error('[RestaurantNotify] kitchen staff lookup failed:', err.message);
  }
}

async function notifyOrderCreated(order) {
  await notifyWaiter(order, {
    title: 'Order sent',
    message: `${ticketLabel(order)} sent to kitchen`,
    status: 'SENT',
    type: 'success',
  });
  await notifyKitchenStaff(order.companyId, order, {
    title: 'New kitchen order',
    message: `${ticketLabel(order)} waiting in queue`,
  });
}

async function notifyOrderPreparing(order) {
  await notifyWaiter(order, {
    title: 'Preparing',
    message: `${ticketLabel(order)} is being prepared`,
    status: 'PREPARING',
    type: 'info',
  });
}

async function notifyOrderReady(order) {
  await notifyWaiter(order, {
    title: 'Order ready',
    message: `${ticketLabel(order)} is ready to serve`,
    status: 'READY',
    type: 'success',
  });
}

async function notifyOrderCancelled(order) {
  await notifyWaiter(order, {
    title: 'Order cancelled',
    message: `${ticketLabel(order)} was cancelled`,
    status: 'CANCELLED',
    type: 'warning',
  });
}

async function notifyOrderPaid(order) {
  await notifyWaiter(order, {
    title: 'Payment received',
    message: `${ticketLabel(order)} has been paid`,
    status: 'PAID',
    type: 'success',
  });
}

module.exports = {
  notifyOrderCreated,
  notifyOrderPreparing,
  notifyOrderReady,
  notifyOrderCancelled,
  notifyOrderPaid,
};
