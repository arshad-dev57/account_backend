// controllers/stripeController.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const Subscription = require('../models/Subscription');

// Plan prices — PKR mein (Stripe paisa CENTS/SMALLEST UNIT mein leta hai)
// PKR ke liye Stripe "1 PKR = 1 unit" leta hai (zero-decimal currency hai PKR)
const PLANS = {
  monthly: {
    amount: 1500,  // 1500 PKR (~$5)
    currency: 'usd',
    name: 'Monthly Plan',
    duration: '30 days',
  },
  yearly: {
    amount: 15000, // 15000 PKR (~$50)
    currency: 'usd',
    name: 'Yearly Plan',
    duration: '365 days',
  },
};
// ==================== CREATE STRIPE CHECKOUT SESSION ====================
exports.createCheckoutSession = async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user.id;

    // Validate plan
    if (!PLANS[plan]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan. Choose "monthly" or "yearly"',
      });
    }

    const selectedPlan = PLANS[plan];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      
      line_items: [
        {
          price_data: {
            currency: selectedPlan.currency,
            product_data: {
              name: selectedPlan.name,
              description: `Full access for ${selectedPlan.duration}`,
            },
            unit_amount: selectedPlan.amount, // PKR zero-decimal hai
          },
          quantity: 1,
        },
      ],

      // ✅ Webhook ke liye metadata — userId aur plan yahin store hoga
      metadata: {
        userId: userId.toString(),
        plan: plan,
      },

      // ✅ Payment ke baad Flutter Web yahan redirect karega
      success_url: `${process.env.FRONTEND_URL}/payment-success`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard`,
    });

    console.log('Stripe session created:', session.id, 'for user:', userId);

    res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        checkoutUrl: session.url, // Flutter yeh URL open karega
      },
    });

  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== STRIPE WEBHOOK (Payment Confirm hone par) ====================
// ⚠️ Yeh route express.raw() use karta hai — JSON parser nahi lagana
exports.handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    // Stripe webhook verify karo
    event = stripe.webhooks.constructEvent(
      req.body,           // raw body chahiye
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Sirf successful payment handle karo
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      const { userId, plan } = session.metadata;
      const amountPaid = session.amount_total; // PKR mein

      console.log('Payment successful for user:', userId, 'Plan:', plan);

      // User dhundo
      let user = await User.findById(userId);
      if (!user) {
        console.error('User not found for webhook:', userId);
        return res.status(404).json({ message: 'User not found' });
      }

      // ✅ Subscription activate karo (tumhara existing method)
      await user.activateSubscription(plan, amountPaid);
      user = await User.findById(userId);

      // ✅ Subscription record banao
      await Subscription.create({
        userId: user._id,
        plan,
        startDate: user.subscription.startDate,
        endDate: user.subscription.endDate,
        amount: amountPaid,
        paymentMethod: 'stripe',
        transactionId: session.payment_intent || session.id,
        paymentDetails: {
          stripeSessionId: session.id,
          stripePaymentIntent: session.payment_intent,
          customerEmail: session.customer_details?.email || '',
        },
      });

      console.log('Subscription activated via webhook for user:', userId);

    } catch (err) {
      console.error('Error processing webhook payment:', err);
      // Stripe ko 500 bhejo — woh retry karega
      return res.status(500).json({ message: 'Internal error processing payment' });
    }
  }

  // ✅ Stripe ko 200 bhejo — confirm karo event mila
  res.status(200).json({ received: true });
};

// ==================== VERIFY SESSION (Success page ke liye) ====================
// Flutter success page par aake yeh call karega confirm karne ke liye
exports.verifySession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      // User ki current subscription bhi wapis bhejo
      const user = await User.findById(req.user.id);

      return res.status(200).json({
        success: true,
        data: {
          paymentStatus: 'paid',
          plan: session.metadata.plan,
          subscription: user?.subscription || null,
        },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        paymentStatus: session.payment_status, // 'unpaid' ya 'no_payment_required'
      },
    });

  } catch (error) {
    console.error('Error verifying session:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};