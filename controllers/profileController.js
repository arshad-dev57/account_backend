const User = require('../models/User');

// ==================== GET PROFILE ====================
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prepare profile data
    const profile = {
      organizationName: user.organizationName || '',
      personName: `${user.firstName} ${user.lastName}`.trim(),
      address: user.address || '',
      email: user.email,
      contactNo: user.contactNo || user.phone || '',
      websiteLink: user.websiteLink || '',
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
    const {
      organizationName,
      personName,
      address,
      email,
      contactNo,
      websiteLink,
    } = req.body;

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Update organization fields
    if (organizationName !== undefined) {
      user.organizationName = organizationName;
    }
    
    // Handle person name (split into first and last name)
    if (personName !== undefined && personName.trim() !== '') {
      const nameParts = personName.trim().split(' ');
      user.firstName = nameParts[0] || user.firstName;
      user.lastName = nameParts.slice(1).join(' ') || user.lastName;
    }
    
    if (address !== undefined) {
      user.address = address;
    }
    
    // Update email if changed
    if (email !== undefined && email !== user.email) {
      // Check if email already exists
      const emailExists = await User.findOne({ 
        email: email.toLowerCase(), 
        _id: { $ne: user._id } 
      });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists',
        });
      }
      user.email = email.toLowerCase();
    }
    
    if (contactNo !== undefined) {
      user.contactNo = contactNo;
      user.phone = contactNo; // Sync with phone field
    }
    
    if (websiteLink !== undefined) {
      user.websiteLink = websiteLink;
    }

    await user.save();

    // Prepare response profile data
    const profile = {
      organizationName: user.organizationName || '',
      personName: `${user.firstName} ${user.lastName}`.trim(),
      address: user.address || '',
      email: user.email,
      contactNo: user.contactNo || user.phone || '',
      websiteLink: user.websiteLink || '',
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