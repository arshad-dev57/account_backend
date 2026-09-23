// config/hrDocumentUpload.js

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Ensure Cloudinary is configured
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
    const folder = `hr/documents/${companyId}`;

    return {
      folder: folder,
      resource_type: 'auto',
      public_id: `hrdoc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    };
  }
});

const hrDocumentUpload = multer({
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

module.exports = { cloudinary, hrDocumentUpload };
