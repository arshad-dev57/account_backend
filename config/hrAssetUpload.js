// config/hrAssetUpload.js

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Ensure Cloudinary credentials are configured
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const ext = file.originalname.split('.').pop().toLowerCase();
    const companyId = req.user?.companyId || 'default';
    
    // Categorize folder based on fieldname
    let folder = `hr/branding/${companyId}`;
    if (file.fieldname === 'signature' || file.fieldname === 'stamp') {
      folder = `hr/signatures/${companyId}`;
    } else if (file.fieldname === 'document' || file.fieldname === 'file') {
      folder = `hr/documents/${companyId}`;
    }

    return {
      folder: folder,
      resource_type: 'auto',
      public_id: `hrasset_${file.fieldname}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    };
  }
});

const hrAssetUpload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'webp'];
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: .${ext}. Allowed formats: ${allowedExtensions.join(', ')}`));
    }
  }
});

module.exports = { cloudinary, hrAssetUpload };
