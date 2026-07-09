// models/User.js - Prisma Version (COMPLETE FIXED)

const prisma = require('../prisma/client');
const bcrypt = require('bcryptjs');

class User {
  // ========== STATIC METHODS (Class-level) ==========

  // Find user by email or id
  static async findOne(query) {
    if (query.email) {
      return await prisma.user.findUnique({
        where: { email: query.email }
      });
    }
    if (query._id) {
      return await prisma.user.findUnique({
        where: { id: query._id }
      });
    }
    return null;
  }

  // ✅ FIXED: Find user by id with businessDetails
  static async findById(id) {
    console.log('🔍 [User.findById] Looking for user:', id);

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        password: true,
        country: true,
        phone: true,
        address: true,
        organizationName: true,
        websiteLink: true,
        contactNo: true,
        businessDetails: true, // ✅ ADDED
        role: true,
        isActive: true,
        failedLoginAttempts: true,
        lockUntil: true,
        requiresLoginOtp: true,
        loginOtp: true,
        loginOtpExpiry: true,
        resetOtp: true,
        resetOtpExpiry: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        trialStartDate: true,
        trialEndDate: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    console.log('🔍 [User.findById] User found:', user ? 'Yes' : 'No');
    console.log('📦 [User.findById] Business Details:', user?.businessDetails);

    return user;
  }

  // Find user by id with select fields
  static async findByIdWithSelect(id, selectFields) {
    const select = {};
    if (selectFields) {
      const fields = selectFields.replace(/\+/g, '').split(' ');
      fields.forEach(field => {
        if (field === 'password') select.password = true;
        if (field === 'failedLoginAttempts') select.failedLoginAttempts = true;
        if (field === 'lockUntil') select.lockUntil = true;
        if (field === 'requiresLoginOtp') select.requiresLoginOtp = true;
        if (field === 'loginOtp') select.loginOtp = true;
        if (field === 'loginOtpExpiry') select.loginOtpExpiry = true;
        if (field === 'businessDetails') select.businessDetails = true; // ✅ ADDED
      });
    }

    return await prisma.user.findUnique({
      where: { id },
      select: Object.keys(select).length > 0 ? select : undefined
    });
  }

  // Find one with select (for login)
  static async findOneWithSelect(query, selectFields) {
    const select = {};
    if (selectFields) {
      const fields = selectFields.replace(/\+/g, '').split(' ');
      fields.forEach(field => {
        select[field] = true;
      });
    }

    return await prisma.user.findUnique({
      where: { email: query.email },
      select: Object.keys(select).length > 0 ? select : undefined
    });
  }

  // Create user
  static async create(data) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(data.password, salt);

    const userData = {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      password: hashedPassword,
      country: data.country,
      phone: data.phone || '',
      address: data.address || '',
      organizationName: data.organizationName || '',
      businessDetails: data.businessDetails || {}, // ✅ ADDED
      subscriptionPlan: 'none',
      subscriptionStatus: 'active',
    };

    return await prisma.user.create({
      data: userData
    });
  }

  // Find and update
  static async findByIdAndUpdate(id, updateData) {
    let data = {};

    if (updateData.$set) {
      const setData = updateData.$set;

      if (setData['subscription.plan']) data.subscriptionPlan = setData['subscription.plan'];
      if (setData['subscription.status']) data.subscriptionStatus = setData['subscription.status'];
      if (setData['subscription.startDate']) data.subscriptionStartDate = setData['subscription.startDate'];
      if (setData['subscription.endDate']) data.subscriptionEndDate = setData['subscription.endDate'];
      if (setData['subscription.trialStartDate']) data.trialStartDate = setData['subscription.trialStartDate'];
      if (setData['subscription.trialEndDate']) data.trialEndDate = setData['subscription.trialEndDate'];

      if (setData.firstName) data.firstName = setData.firstName;
      if (setData.lastName) data.lastName = setData.lastName;
      if (setData.email) data.email = setData.email;
      if (setData.phone) data.phone = setData.phone;
      if (setData.country) data.country = setData.country;
      if (setData.address) data.address = setData.address;
      if (setData.organizationName) data.organizationName = setData.organizationName;
      if (setData.businessDetails) data.businessDetails = setData.businessDetails; // ✅ ADDED
      if (setData.isActive !== undefined) data.isActive = setData.isActive;
      if (setData.failedLoginAttempts !== undefined) data.failedLoginAttempts = setData.failedLoginAttempts;
      if (setData.lockUntil !== undefined) data.lockUntil = setData.lockUntil;
      if (setData.requiresLoginOtp !== undefined) data.requiresLoginOtp = setData.requiresLoginOtp;
      if (setData.loginOtp !== undefined) data.loginOtp = setData.loginOtp;
      if (setData.loginOtpExpiry !== undefined) data.loginOtpExpiry = setData.loginOtpExpiry;
      if (setData.resetOtp !== undefined) data.resetOtp = setData.resetOtp;
      if (setData.resetOtpExpiry !== undefined) data.resetOtpExpiry = setData.resetOtpExpiry;
    } else {
      data = updateData;
    }

    return await prisma.user.update({
      where: { id },
      data
    });
  }

  // Find one and update (for subscription expiry)
  static async findOneAndUpdate(filter, updateData, options) {
    let data = {};
    if (updateData.$set) {
      const setData = updateData.$set;
      if (setData['subscription.status']) data.subscriptionStatus = setData['subscription.status'];
    }

    const updated = await prisma.user.update({
      where: { id: filter._id },
      data
    });

    return updated;
  }

  // ========== INSTANCE METHODS (Object-level) ==========

  // ✅ FIXED: Constructor with businessDetails
  constructor(userData) {
    this._id = userData.id;
    this.id = userData.id;
    this.firstName = userData.firstName;
    this.lastName = userData.lastName;
    this.email = userData.email;
    this.password = userData.password;
    this.phone = userData.phone || '';
    this.country = userData.country;
    this.role = userData.role || 'user';
    this.isActive = userData.isActive !== undefined ? userData.isActive : true;
    this.failedLoginAttempts = userData.failedLoginAttempts || 0;
    this.lockUntil = userData.lockUntil || null;
    this.requiresLoginOtp = userData.requiresLoginOtp || false;
    this.loginOtp = userData.loginOtp || null;
    this.loginOtpExpiry = userData.loginOtpExpiry || null;
    this.resetOtp = userData.resetOtp || null;
    this.resetOtpExpiry = userData.resetOtpExpiry || null;
    this.organizationName = userData.organizationName || '';
    this.address = userData.address || '';
    this.contactNo = userData.contactNo || '';
    this.websiteLink = userData.websiteLink || '';
    this.businessDetails = userData.businessDetails || {}; // ✅ ADDED
    this.subscription = {
      plan: userData.subscriptionPlan || 'none',
      status: userData.subscriptionStatus || 'active',
      startDate: userData.subscriptionStartDate || null,
      endDate: userData.subscriptionEndDate || null,
      trialStartDate: userData.trialStartDate || null,
      trialEndDate: userData.trialEndDate || null,
    };
    this.createdAt = userData.createdAt;
    this.updatedAt = userData.updatedAt;
    this.constructor = User;
  }

  // Match password
  async matchPassword(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
  }

  // Check if trial is expired
  isTrialExpired() {
    if (!this.subscription.trialEndDate) return true;
    return new Date() > new Date(this.subscription.trialEndDate);
  }

  // Check if account is locked
  isLocked() {
    return this.lockUntil && new Date(this.lockUntil) > new Date();
  }

  // Check if user has active subscription
  hasActiveSubscription() {
    if (this.subscription.plan === 'trial' &&
      this.subscription.trialEndDate &&
      new Date() <= new Date(this.subscription.trialEndDate)) {
      return true;
    }

    if ((this.subscription.plan === 'monthly' || this.subscription.plan === 'yearly') &&
      this.subscription.status === 'active' &&
      this.subscription.endDate &&
      new Date() <= new Date(this.subscription.endDate)) {
      return true;
    }

    return false;
  }

  // Get trial days remaining
  getTrialDaysRemaining() {
    if (!this.subscription.trialEndDate) return 0;
    const now = new Date();
    const end = new Date(this.subscription.trialEndDate);
    if (now > end) return 0;
    const diffTime = Math.abs(end - now);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  // Get subscription days remaining
  getSubscriptionDaysRemaining() {
    if (!this.subscription.endDate) return 0;
    const now = new Date();
    const end = new Date(this.subscription.endDate);
    if (now > end) return 0;
    const diffTime = Math.abs(end - now);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  // Start free trial
  async startTrial() {
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 30);

    const updated = await prisma.user.update({
      where: { id: this._id },
      data: {
        subscriptionPlan: 'trial',
        subscriptionStatus: 'active',
        subscriptionStartDate: now,
        subscriptionEndDate: null,
        trialStartDate: now,
        trialEndDate: trialEnd,
      }
    });

    this.subscription = {
      plan: updated.subscriptionPlan,
      status: updated.subscriptionStatus,
      startDate: updated.subscriptionStartDate,
      endDate: updated.subscriptionEndDate,
      trialStartDate: updated.trialStartDate,
      trialEndDate: updated.trialEndDate,
    };

    console.log('Trial started for user:', this._id);
    return updated;
  }

  // Activate paid subscription
  async activateSubscription(plan, amount) {
    const now = new Date();
    let endDate = new Date(now);

    if (plan === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (plan === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    console.log('Activating subscription:', { plan, status: 'active', startDate: now, endDate });

    const updated = await prisma.user.update({
      where: { id: this._id },
      data: {
        subscriptionPlan: plan,
        subscriptionStatus: 'active',
        subscriptionStartDate: now,
        subscriptionEndDate: endDate,
        trialStartDate: null,
        trialEndDate: null,
      }
    });

    this.subscription = {
      plan: updated.subscriptionPlan,
      status: updated.subscriptionStatus,
      startDate: updated.subscriptionStartDate,
      endDate: updated.subscriptionEndDate,
      trialStartDate: updated.trialStartDate,
      trialEndDate: updated.trialEndDate,
    };

    console.log('Subscription activated for user:', this._id);
    return updated;
  }

  // Expire subscription
  async expireSubscription() {
    const user = await prisma.user.findUnique({
      where: { id: this._id }
    });

    if (user && user.subscriptionStatus === 'active') {
      const updated = await prisma.user.update({
        where: { id: this._id },
        data: {
          subscriptionStatus: 'expired'
        }
      });

      this.subscription.status = 'expired';
      console.log('Subscription expired for user:', this._id);
      return updated;
    } else {
      console.log('Subscription already expired, skipping...');
      return null;
    }
  }

  // ✅ FIXED: Save method with businessDetails
  async save() {
    const data = {};

    if (this.firstName) data.firstName = this.firstName;
    if (this.lastName) data.lastName = this.lastName;
    if (this.email) data.email = this.email;
    if (this.password) data.password = this.password;
    if (this.phone !== undefined) data.phone = this.phone;
    if (this.country) data.country = this.country;
    if (this.address !== undefined) data.address = this.address;
    if (this.organizationName !== undefined) data.organizationName = this.organizationName;
    if (this.websiteLink !== undefined) data.websiteLink = this.websiteLink;
    if (this.contactNo !== undefined) data.contactNo = this.contactNo;
    if (this.businessDetails !== undefined) data.businessDetails = this.businessDetails; // ✅ ADDED

    if (this.isActive !== undefined) data.isActive = this.isActive;
    if (this.failedLoginAttempts !== undefined) data.failedLoginAttempts = this.failedLoginAttempts;
    if (this.lockUntil !== undefined) data.lockUntil = this.lockUntil;
    if (this.requiresLoginOtp !== undefined) data.requiresLoginOtp = this.requiresLoginOtp;
    if (this.loginOtp !== undefined) data.loginOtp = this.loginOtp;
    if (this.loginOtpExpiry !== undefined) data.loginOtpExpiry = this.loginOtpExpiry;
    if (this.resetOtp !== undefined) data.resetOtp = this.resetOtp;
    if (this.resetOtpExpiry !== undefined) data.resetOtpExpiry = this.resetOtpExpiry;

    if (this.subscription) {
      if (this.subscription.plan) data.subscriptionPlan = this.subscription.plan;
      if (this.subscription.status) data.subscriptionStatus = this.subscription.status;
      if (this.subscription.startDate) data.subscriptionStartDate = this.subscription.startDate;
      if (this.subscription.endDate !== undefined) data.subscriptionEndDate = this.subscription.endDate;
      if (this.subscription.trialStartDate !== undefined) data.trialStartDate = this.subscription.trialStartDate;
      if (this.subscription.trialEndDate !== undefined) data.trialEndDate = this.subscription.trialEndDate;
    }

    const updated = await prisma.user.update({
      where: { id: this._id },
      data
    });

    Object.assign(this, updated);
    return updated;
  }
}

module.exports = User;