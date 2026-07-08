// controllers/profileController.js - PURE JAVASCRIPT (FIXED)

const prisma = require('../prisma/client');

// ==================== GET PROFILE ====================
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        country: true,
        address: true,
        organizationName: true,
        websiteLink: true,
        contactNo: true,
        businessDetails: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // ✅ FIX: JavaScript mein 'as' nahi, simple object access
    const businessDetails = user.businessDetails || {};

    // ✅ FIX: JavaScript mein 'final' nahi, 'const' use karein
    const profile = {
      id: user.id,
      organizationName: user.organizationName || '',
      personName: `${user.firstName} ${user.lastName}`.trim(),
      firstName: user.firstName,
      lastName: user.lastName,
      address: user.address || '',
      email: user.email,
      phone: user.phone || '',
      contactNo: user.contactNo || user.phone || '',
      websiteLink: user.websiteLink || '',
      country: user.country || '',
      
      businessDetails: {
        logo: businessDetails.logo || '',
        fiscalYear: businessDetails.fiscalYear || '',
        taxRegistrationNumber: businessDetails.taxRegistrationNumber || '',
        signature: businessDetails.signature || '',
        industry: businessDetails.industry || '',
        businessType: businessDetails.businessType || '',
      },
      
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    console.error('Error getting profile:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== UPDATE PROFILE ====================
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      firstName,
      lastName,
      personName,
      email,
      phone,
      country,
      address,
      contactNo,
      websiteLink,
      organizationName,
      logo,
      fiscalYear,
      taxRegistrationNumber,
      signature,
      industry,
      businessType,
    } = req.body;

    // ─── CHECK IF USER EXISTS ────────────────────────────────
    const existingUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // ─── BUILD UPDATE DATA ──────────────────────────────────
    const updateData = {};

    // ─── PERSONAL INFO ────────────────────────────────────────
    if (firstName !== undefined) {
      updateData.firstName = firstName;
    }
    
    if (lastName !== undefined) {
      updateData.lastName = lastName;
    }
    
    // Handle personName (split into first and last name)
    if (personName !== undefined && personName.trim() !== '') {
      const nameParts = personName.trim().split(' ');
      updateData.firstName = nameParts[0] || existingUser.firstName;
      updateData.lastName = nameParts.slice(1).join(' ') || existingUser.lastName;
    }

    // ─── EMAIL (with duplicate check) ─────────────────────────
    if (email !== undefined && email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });
      
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists',
        });
      }
      updateData.email = email.toLowerCase();
    }

    // ─── OTHER FIELDS ──────────────────────────────────────────
    if (phone !== undefined) updateData.phone = phone;
    if (country !== undefined) updateData.country = country;
    if (address !== undefined) updateData.address = address;
    if (websiteLink !== undefined) updateData.websiteLink = websiteLink;
    if (organizationName !== undefined) updateData.organizationName = organizationName;
    
    // Sync contactNo with phone
    if (contactNo !== undefined) {
      updateData.contactNo = contactNo;
      if (phone === undefined) {
        updateData.phone = contactNo;
      }
    }

    // ─── BUSINESS DETAILS (JSON) ──────────────────────────────
    // ✅ FIX: Get existing business details
    const existingBusinessDetails = existingUser.businessDetails || {};
    
    // ✅ FIX: Create updated business details
    const updatedBusinessDetails = {
      logo: logo || existingBusinessDetails.logo || '',
      fiscalYear: fiscalYear || existingBusinessDetails.fiscalYear || '',
      taxRegistrationNumber: taxRegistrationNumber || existingBusinessDetails.taxRegistrationNumber || '',
      signature: signature || existingBusinessDetails.signature || '',
      industry: industry || existingBusinessDetails.industry || '',
      businessType: businessType || existingBusinessDetails.businessType || '',
    };

    // Only update if any business detail is provided
    if (logo !== undefined || fiscalYear !== undefined || 
        taxRegistrationNumber !== undefined || signature !== undefined ||
        industry !== undefined || businessType !== undefined) {
      updateData.businessDetails = updatedBusinessDetails;
    }

    // ─── UPDATE USER ──────────────────────────────────────────
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        country: true,
        address: true,
        organizationName: true,
        websiteLink: true,
        contactNo: true,
        businessDetails: true,
        updatedAt: true,
      }
    });

    // ✅ FIX: JavaScript mein 'as' nahi
    const businessDetails = updatedUser.businessDetails || {};

    const profile = {
      id: updatedUser.id,
      organizationName: updatedUser.organizationName || '',
      personName: `${updatedUser.firstName} ${updatedUser.lastName}`.trim(),
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      address: updatedUser.address || '',
      email: updatedUser.email,
      phone: updatedUser.phone || '',
      contactNo: updatedUser.contactNo || updatedUser.phone || '',
      websiteLink: updatedUser.websiteLink || '',
      country: updatedUser.country || '',
      
      businessDetails: {
        logo: businessDetails.logo || '',
        fiscalYear: businessDetails.fiscalYear || '',
        taxRegistrationNumber: businessDetails.taxRegistrationNumber || '',
        signature: businessDetails.signature || '',
        industry: businessDetails.industry || '',
        businessType: businessDetails.businessType || '',
      },
      
      updatedAt: updatedUser.updatedAt,
    };

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: profile,
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== UPDATE BUSINESS DETAILS ONLY ====================
exports.updateBusinessDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      logo,
      fiscalYear,
      taxRegistrationNumber,
      signature,
      industry,
      businessType,
    } = req.body;

    // ─── CHECK IF USER EXISTS ────────────────────────────────
    const existingUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // ✅ FIX: Get existing business details
    const existingBusinessDetails = existingUser.businessDetails || {};

    // ✅ FIX: Update business details
    const updatedBusinessDetails = {
      logo: logo || existingBusinessDetails.logo || '',
      fiscalYear: fiscalYear || existingBusinessDetails.fiscalYear || '',
      taxRegistrationNumber: taxRegistrationNumber || existingBusinessDetails.taxRegistrationNumber || '',
      signature: signature || existingBusinessDetails.signature || '',
      industry: industry || existingBusinessDetails.industry || '',
      businessType: businessType || existingBusinessDetails.businessType || '',
    };

    // ─── UPDATE USER ──────────────────────────────────────────
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        businessDetails: updatedBusinessDetails,
      },
      select: {
        id: true,
        businessDetails: true,
        updatedAt: true,
      }
    });

    // ✅ FIX: JavaScript mein 'as' nahi
    const businessDetails = updatedUser.businessDetails || {};

    res.status(200).json({
      success: true,
      message: 'Business details updated successfully',
      data: {
        businessDetails: {
          logo: businessDetails.logo || '',
          fiscalYear: businessDetails.fiscalYear || '',
          taxRegistrationNumber: businessDetails.taxRegistrationNumber || '',
          signature: businessDetails.signature || '',
          industry: businessDetails.industry || '',
          businessType: businessDetails.businessType || '',
        },
        updatedAt: updatedUser.updatedAt,
      }
    });
  } catch (error) {
    console.error('Error updating business details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== GET BUSINESS DETAILS ONLY ====================
exports.getBusinessDetails = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        organizationName: true,
        websiteLink: true,
        contactNo: true,
        address: true,
        phone: true,
        country: true,
        businessDetails: true,
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // ✅ FIX: JavaScript mein 'as' nahi
    const businessDetails = user.businessDetails || {};

    res.status(200).json({
      success: true,
      data: {
        organizationName: user.organizationName || '',
        websiteLink: user.websiteLink || '',
        contactNo: user.contactNo || user.phone || '',
        address: user.address || '',
        phone: user.phone || '',
        country: user.country || '',
        businessDetails: {
          logo: businessDetails.logo || '',
          fiscalYear: businessDetails.fiscalYear || '',
          taxRegistrationNumber: businessDetails.taxRegistrationNumber || '',
          signature: businessDetails.signature || '',
          industry: businessDetails.industry || '',
          businessType: businessDetails.businessType || '',
        },
      }
    });
  } catch (error) {
    console.error('Error getting business details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== UPDATE PROFILE IMAGE ====================
exports.updateProfileImage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { logo, signature } = req.body;

    if (!logo && !signature) {
      return res.status(400).json({
        success: false,
        message: 'Please provide logo or signature to update',
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // ✅ FIX: Get existing business details
    const existingBusinessDetails = existingUser.businessDetails || {};

    const updatedBusinessDetails = {
      logo: logo || existingBusinessDetails.logo || '',
      fiscalYear: existingBusinessDetails.fiscalYear || '',
      taxRegistrationNumber: existingBusinessDetails.taxRegistrationNumber || '',
      signature: signature || existingBusinessDetails.signature || '',
      industry: existingBusinessDetails.industry || '',
      businessType: existingBusinessDetails.businessType || '',
    };

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        businessDetails: updatedBusinessDetails,
      },
      select: {
        id: true,
        businessDetails: true,
        updatedAt: true,
      }
    });

    // ✅ FIX: JavaScript mein 'as' nahi
    const businessDetails = updatedUser.businessDetails || {};

    res.status(200).json({
      success: true,
      message: 'Profile image updated successfully',
      data: {
        logo: businessDetails.logo || '',
        signature: businessDetails.signature || '',
        updatedAt: updatedUser.updatedAt,
      }
    });
  } catch (error) {
    console.error('Error updating profile image:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};