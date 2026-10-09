// config/expenseUpload.js — reuses Cloudinary like HR documents

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => {
    const companyId = req.user?.companyId || 'default';
    return {
      folder: `accounting/expenses/${companyId}`,
      resource_type: 'auto',
      public_id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    };
  },
});

const expenseUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'webp'];
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Invalid file type: .${ext}`));
  },
});

module.exports = { cloudinary, expenseUpload };
