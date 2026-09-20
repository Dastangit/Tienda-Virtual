const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true // Evita correos duplicados en la base de datos
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['cliente', 'admin'],
        default: 'cliente'
    }
}, { timestamps: true });

// MAGIA DE SEGURIDAD: Encriptar contraseña antes de guardar
// (Mongoose 9: los hooks async ya no usan next() como callback, basta con
// devolver o dejar completar la promesa)
userSchema.pre('save', async function () {
    // Si la contraseña no ha sido modificada, no la volvemos a encriptar
    if (!this.isModified('password')) {
        return;
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model('User', userSchema);