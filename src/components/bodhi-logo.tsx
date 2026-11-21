interface BodhiLogoProps {
  className?: string;
}

export function BodhiLogo({ className = "h-7 w-7" }: BodhiLogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Left half of the Bodhi leaf */}
      <path
        d="M32 6 C30 14 25 18 20 22.5 C13.5 28.5 10.5 36.5 13.5 44 C15.8 49.8 22.4 52.4 28.4 49.8 C30 49 31.2 47.8 32 46.5 Z"
        className="fill-[#577562] dark:fill-[#7EA390]"
      />
      {/* Right half of the Bodhi leaf */}
      <path
        d="M32 6 C34 14 39 18 44 22.5 C50.5 28.5 53.5 36.5 50.5 44 C48.2 49.8 41.6 52.4 35.6 49.8 C34 49 32.8 47.8 32 46.5 Z"
        className="fill-[#435F4E] dark:fill-[#608472]"
      />
      {/* Dark stem edge */}
      <path
        d="M32.4 45.5 C32.4 51 31.7 55 30.3 57.5 L32 57.5 C33.4 54.8 34 50.5 33.7 45.5 Z"
        className="fill-[#435F4E] dark:fill-[#608472]"
      />
      {/* Warm sand central vein & stem */}
      <path
        d="M32 19 C32.5 29.5 32.8 40 32.3 47.5 C32 52 31 55.4 29.4 57.5 L30.7 57.5 C32 55.2 33 51.5 33.2 47.2 C33.4 39.8 32.7 29.2 32 19 Z"
        className="fill-[#DDD0B4] dark:fill-[#E6D9BE]"
      />
    </svg>
  );
}
