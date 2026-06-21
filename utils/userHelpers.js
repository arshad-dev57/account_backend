
const formatUserResponse = (user) => {
  if (!user) return null;

  const baseUser = {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    country: user.country,
    phone: user.phone,
    address: user.address,
    organizationName: user.organizationName,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  // Add subscription data if available
  if (user.subscription) {
    baseUser.subscription = {
      plan: user.subscription.plan,
      status: user.subscription.status,
      trialDaysRemaining: user.getTrialDaysRemaining ? user.getTrialDaysRemaining() : null,
      subscriptionDaysRemaining: user.getSubscriptionDaysRemaining ? user.getSubscriptionDaysRemaining() : null,
      startDate: user.subscription.startDate,
      endDate: user.subscription.endDate,
      trialStartDate: user.subscription.trialStartDate,
      trialEndDate: user.subscription.trialEndDate,
    };
  }

  return baseUser;
};

/**
 * Formats user data for registration response
 */
const formatRegisterResponse = (user, token, refreshToken) => {
  return {
    success: true,
    message: 'User registered successfully. Free trial started for 30 days!',
    token,
    refreshToken,
    user: formatUserResponse(user),
  };
};

/**
 * Formats user data for login/OTP verification response
 */
const formatLoginResponse = (user, token, refreshToken) => {
  return {
    success: true,
    message: 'Login successful',
    token,
    refreshToken,
    user: formatUserResponse(user),
  };
};

/**
 * Formats user data for getMe response
 */
const formatGetMeResponse = (user) => {
  return {
    success: true,
    user: formatUserResponse(user),
  };
};

module.exports = {
  formatUserResponse,
  formatRegisterResponse,
  formatLoginResponse,
  formatGetMeResponse,
};