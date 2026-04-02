import { motion } from 'framer-motion';

interface ButtonProps {
  text: string;
  href: string;
}

export default function AnimatedButton({ text, href }: ButtonProps) {
  return (
    <motion.a
      href={href}
      className="relative inline-block px-6 py-3 rounded-lg text-sm font-medium whitespace-nowrap"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--color-text)',
      }}
      whileHover={{
        scale: 1.02,
        y: -1,
      }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.15 }}
    >
      {text}
    </motion.a>
  );
}
