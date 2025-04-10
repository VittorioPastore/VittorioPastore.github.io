import { motion } from 'framer-motion';

interface ButtonProps {
  text: string;
  href: string;
}

export default function AnimatedButton({ text, href }: ButtonProps) {
  return (
    <motion.a
      href={href}
      className="relative glass px-8 py-4 rounded-full text-white font-medium 
                 hover:bg-white/20 transition-all duration-300 inline-block
                 overflow-hidden group"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <span className="relative z-10">{text}</span>
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-pink-500 to-purple-500 opacity-0 group-hover:opacity-20 
                   transition-opacity duration-300"
        initial={false}
        whileHover={{ scale: 1.2, rotate: 5 }}
      />
      <div className="absolute inset-0 border border-white/20 rounded-full" />
    </motion.a>
  );
}