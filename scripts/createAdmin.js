require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const ADMIN_EMAIL = 'admin003@gmail.com';
const ADMIN_PASSWORD = 'M@rio_1234';
const ADMIN_NAME = 'Admin';
const ADMIN_DUI = '00000000-0';

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        let user = await User.findOne({ email: ADMIN_EMAIL });
        if (user) {
            console.log('Admin ya existe');
            process.exit(0);
        }
        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash(ADMIN_PASSWORD, salt);
        user = await User.create({
            name: ADMIN_NAME,
            email: ADMIN_EMAIL,
            password: hashed,
            dui: ADMIN_DUI,
            role: 'admin'
        });
        console.log('Admin creado:', user.email);
    } catch (err) {
        console.error(err);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
    }
};

run();
