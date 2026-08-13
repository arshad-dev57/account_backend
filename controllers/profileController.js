const prisma = require('../prisma/client');

function formatBusinessDetails(businessDetails = {}) {
  const bd = businessDetails || {};
  return {
    logo: bd.logo || '',
    fiscalYear: bd.fiscalYear || '',
    taxRegistrationNumber: bd.taxRegistrationNumber || '',
    signature: bd.signature || '',
    industry: bd.industry || '',
    businessType: bd.businessType || '',
    currencyCode: bd.currencyCode || '',
    currencySymbol: bd.currencySymbol || '',
  };
}

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
        company: {
          select: {
            id: true,
            name: true,
            logo: true,
            address: true,
            phone: true,
            email: true,
            website: true,
            taxRegistrationNumber: true,
          },
        },
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const businessDetails = user.businessDetails || {};

    const profile = {
      id: user.id,
      organizationName: user.organizationName || user.company?.name || '',
      personName: `${user.firstName} ${user.lastName}`.trim(),
      firstName: user.firstName,
      lastName: user.lastName,
      address: user.address || user.company?.address || '',
      email: user.email,
      phone: user.phone || '',
      contactNo: user.contactNo || user.phone || user.company?.phone || '',
      websiteLink: user.websiteLink || user.company?.website || '',
      country: user.country || '',
      company: user.company || null,
      businessDetails: formatBusinessDetails({
        ...businessDetails,
        logo: businessDetails.logo || user.company?.logo || '',
        taxRegistrationNumber:
          businessDetails.taxRegistrationNumber || user.company?.taxRegistrationNumber || '',
      }),
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
      fiscalYear,
      taxRegistrationNumber,
      industry,
      businessType,
    } = req.body;

    let logo = req.body.logo;
    let signature = req.body.signature;

    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        logo = req.files.logo[0].path;
      }
      if (req.files.signature && req.files.signature[0]) {
        signature = req.files.signature[0].path;
      }
    }

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
    const existingBusinessDetails = existingUser.businessDetails || {};
    
    const updatedBusinessDetails = {
      ...existingBusinessDetails,
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
      
      businessDetails: formatBusinessDetails(businessDetails),
      
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
      fiscalYear,
      taxRegistrationNumber,
      industry,
      businessType,
    } = req.body;

    let logo = req.body.logo;
    let signature = req.body.signature;

    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        logo = req.files.logo[0].path;
      }
      if (req.files.signature && req.files.signature[0]) {
        signature = req.files.signature[0].path;
      }
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

    const existingBusinessDetails = existingUser.businessDetails || {};

    const updatedBusinessDetails = {
      ...existingBusinessDetails,
      logo: logo || existingBusinessDetails.logo || '',
      fiscalYear: fiscalYear || existingBusinessDetails.fiscalYear || '',
      taxRegistrationNumber: taxRegistrationNumber || existingBusinessDetails.taxRegistrationNumber || '',
      signature: signature || existingBusinessDetails.signature || '',
      industry: industry || existingBusinessDetails.industry || '',
      businessType: businessType || existingBusinessDetails.businessType || '',
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

    const businessDetails = updatedUser.businessDetails || {};

    res.status(200).json({
      success: true,
      message: 'Business details updated successfully',
      data: {
        businessDetails: formatBusinessDetails(businessDetails),
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
        businessDetails: formatBusinessDetails(businessDetails),
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

exports.updateProfileImage = async (req, res) => {
  try {
    const userId = req.user.id;
    let logo = req.body.logo;
    let signature = req.body.signature;

    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        logo = req.files.logo[0].path;
      }
      if (req.files.signature && req.files.signature[0]) {
        signature = req.files.signature[0].path;
      }
    }

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

    const existingBusinessDetails = existingUser.businessDetails || {};

    const updatedBusinessDetails = {
      ...existingBusinessDetails,
      logo: logo || existingBusinessDetails.logo || '',
      signature: signature || existingBusinessDetails.signature || '',
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
