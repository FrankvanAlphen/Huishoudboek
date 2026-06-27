import { hashPassword } from "../auth.js";

/**
 * Genereer eenmalig een wachtwoordhash voor het gedeelde huishoud-wachtwoord.
 * Gebruik:  npm run hash-password -- "JouwWachtwoord"
 * Plaats de uitvoer in AUTH_PASSWORD_HASH in je .env / Railway-variabelen.
 */
const plain = process.argv[2];
if (!plain) {
  console.error('Gebruik: npm run hash-password -- "JouwWachtwoord"');
  process.exit(1);
}

console.log(hashPassword(plain));
