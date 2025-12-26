// Definición de planes y límites (para usar en siguientes fases)
const MB = 1024 * 1024;
const plans = {
    personal: {
        id: 'personal',
        name: 'Plan A (Personal)',
        price: 6.99,
        dteLimit: 100,
        zipLimitBytes: 100 * MB,
        gmailLimit: 1,
        replaceQuota: 1,
        replaceWindowDays: 60
    },
    negocio: {
        id: 'negocio',
        name: 'Plan B (Negocio)',
        price: 9.99,
        dteLimit: 250,
        zipLimitBytes: 250 * MB,
        gmailLimit: 2,
        replaceQuota: 1,
        replaceWindowDays: 30
    },
    pro: {
        id: 'pro',
        name: 'Plan C (Pro)',
        price: 14.99,
        dteLimit: 800,
        zipLimitBytes: 500 * MB,
        gmailLimit: 4,
        replaceQuota: 2,
        replaceWindowDays: 30
    }
};

const allowedPlans = Object.keys(plans);
const allowedStatuses = ['active', 'canceled'];

module.exports = { plans, allowedPlans, allowedStatuses };
