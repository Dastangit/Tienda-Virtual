const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true,
        unique: true // Evita numeros duplicados en la base de datos
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['cliente', 'admin'],
        default: 'cliente'
    },
    // Cuando cambia la contrasena, los tokens emitidos ANTES dejan de valer (authMiddleware):
    // asi un restablecimiento cierra la sesion en el telefono que el cliente perdio o presto.
    passwordChangedAt: {
        type: Date
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
    // Al crear la cuenta no hace falta: no existe ningun token anterior
    if (!this.isNew) {
        this.passwordChangedAt = new Date();
    }
});

module.exports = mongoose.model('User', userSchema);
