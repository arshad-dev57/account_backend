const prisma = require('../prisma/client');

const PAID_PLANS = ['monthly', 'yearly'];

/**
 * Free trial is granted once at registration. Users who already used a trial,
 * subscribed to a paid plan, or cancelled a paid plan cannot start another trial.
 */
async function getTrialEligibility(userId, companyId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { eligible: false, reason: 'user_not_found' };
  }

  const plan = user.subscriptionPlan || 'none';
  const status = user.subscriptionStatus || 'expired';

  if (plan === 'trial' && status === 'active') {
    return { eligible: false, reason: 'active_trial' };
  }

  if (plan === 'trial' && status === 'expired') {
    return { eligible: false, reason: 'trial_used' };
  }

  if (PAID_PLANS.includes(plan)) {
    return { eligible: false, reason: 'had_paid' };
  }

  const priorTrial = await prisma.subscription.findFirst({
    where: { userId, plan: 'trial' },
  });
  if (priorTrial) {
    return { eligible: false, reason: 'trial_used' };
  }

  const priorPaid = await prisma.subscription.findFirst({
    where: { userId, plan: { in: PAID_PLANS } },
  });
  if (priorPaid) {
    return { eligible: false, reason: 'had_paid' };
  }

  if (companyId) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (company) {
      if (PAID_PLANS.includes(company.subscriptionPlan)) {
        return { eligible: false, reason: 'had_paid' };
      }
      if (company.subscriptionPlan === 'trial' && company.subscriptionStatus === 'expired') {
        return { eligible: false, reason: 'trial_used' };
      }
      if (company.subscriptionStartDate) {
        return { eligible: false, reason: 'had_paid' };
      }

      const companyUsers = await prisma.user.findMany({
        where: { companyId },
        select: { id: true },
      });
      const userIds = companyUsers.map((u) => u.id);
      if (userIds.length) {
        const companyTrial = await prisma.subscription.findFirst({
          where: { userId: { in: userIds }, plan: 'trial' },
        });
        if (companyTrial) {
          return { eligible: false, reason: 'trial_used' };
        }

        const companyPaid = await prisma.subscription.findFirst({
          where: { userId: { in: userIds }, plan: { in: PAID_PLANS } },
        });
        if (companyPaid) {
          return { eligible: false, reason: 'had_paid' };
        }
      }
    }
  }

  return { eligible: true, reason: null };
}

function trialIneligibleMessage(reason) {
  switch (reason) {
    case 'active_trial':
      return 'You already have an active free trial.';
    case 'trial_used':
      return 'Your free trial has already been used. Please subscribe to a paid plan to continue.';
    case 'had_paid':
      return 'Free trial is only available for new accounts. Please choose a paid plan below.';
    default:
      return 'Free trial is not available for this account.';
  }
}

module.exports = {
  getTrialEligibility,
  trialIneligibleMessage,
};
