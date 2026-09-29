import React, { useState, useRef, useEffect } from 'react';

export function PageViewer({ imageUrl, selectedField }) {
  const imgRef = useRef(null);
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (imgRef.current) {
      setImgSize({ width: imgRef.current.width, height: imgRef.current.height });
    }
  }, [imageUrl]);

  const onImgLoad = (e) => {
    setImgSize({ width: e.target.width, height: e.target.height });
  };

  if (!imageUrl) {
    return <div className="text-gray-500 font-bold mt-20 uppercase tracking-widest text-sm animate-pulse">Waiting for page image...</div>;
  }

  // bbox jsonb format: {"x":0.12,"y":0.40,"w":0.30,"h":0.03} fractions of page
  const bbox = selectedField?.bbox;

  return (
    <div className="relative inline-block border-4 border-white shadow-2xl bg-white max-w-full">
      <img 
        ref={imgRef}
        src={imageUrl} 
        alt="Document Page" 
        onLoad={onImgLoad}
        className="max-w-full h-auto object-contain transition-opacity duration-300"
        style={{ maxHeight: 'calc(100vh - 120px)' }}
      />
      {bbox && imgSize.width > 0 && (
        <div 
          className="absolute border-2 border-amber-400 bg-amber-400/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] z-10 transition-all duration-300 ease-out pointer-events-none"
          style={{
            left: `${bbox.x * 100}%`,
            top: `${bbox.y * 100}%`,
            width: `${bbox.w * 100}%`,
            height: `${bbox.h * 100}%`,
          }}
        >
          <div className="absolute -top-3 -left-1 bg-amber-400 text-amber-900 text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded shadow-sm">
            Target
          </div>
        </div>
      )}
    </div>
  );
}
