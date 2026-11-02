import React, { useEffect, useState } from 'react';
import '../../styles/KartelShop.css';
import iconToggleCart from '../../res/shopping-cart.png';
import iconLeftArrow from '../../res/left-arrow.png';
import iconRightArrow from '../../res/right-arrow.png';
import iconAddCart from '../../res/add-cart.png';
import iconDelete from '../../res/trash-can.png';
import iconInstagram from '../../res/instagram.png';
import iconFacebook from '../../res/facebook.png';
import iconWhatsapp from '../../res/whatsapp.png';
import iconClose from '../../res/close.png';
import iconHome from '../../res/home.png';

// Images live in public/img as WebP (CRA 5 cannot import .webp from src).
const PUBLIC_URL = process.env.PUBLIC_URL;
const bannerTop = `${PUBLIC_URL}/img/banner.webp`;
const logo = `${PUBLIC_URL}/img/logo.webp`;
const item1 = `${PUBLIC_URL}/img/item1.webp`;
const item2 = `${PUBLIC_URL}/img/item3.webp`;
const item3 = `${PUBLIC_URL}/img/item5.webp`;
const item1side = `${PUBLIC_URL}/img/item2.webp`;
const item2side = `${PUBLIC_URL}/img/item4.webp`;
const item3side = `${PUBLIC_URL}/img/item6.webp`;


const products = [
  { id: 1, picture: item1, picture_side: item1side, name: 'Boy in Dream Cap (white/blue)', price: 22.99 },
  { id: 2, picture: item2, picture_side: item2side, name: 'NY Blue Cap', price: 24.99 },
  { id: 3, picture: item3, picture_side: item3side, name: 'LA Black Cap', price: 23.99 },
];

const KartelShop = ({ setShowParticles }) => {
  const [cartItems, setCartItems] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSlideIndex((prevIndex) => (prevIndex + 1) % products.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const handlePaymentMethod = (method) => {
    console.log(`Selected payment method: ${method}`);
    // Add your logic here for handling the selected payment method
  };

  const addToCart = (product) => {
    setIsSidebarOpen(true);
    setCartItems(prevItems => {
      const existingItem = prevItems.find(item => item.name === product.name);
      return existingItem 
        ? prevItems.map(item => item.name === product.name ? {...item, count: item.count + 1} : item)
        : [...prevItems, { ...product, count: 1 }];
    });
  };

  const removeFromCart = (productId) => {
    setCartItems(prevItems => prevItems.filter(item => item.id !== productId));
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const goBackHome = () => {window.location.href = '/kartel'; };

  const goToNextSlide = () => setActiveSlideIndex((prevIndex) => (prevIndex + 1) % products.length);
  const goToPreviousSlide = () => setActiveSlideIndex((prevIndex) =>
    prevIndex === 0 ? products.length - 1 : prevIndex - 1
  );

  const renderCartItems = () => {
    const uniqueCartItems = Array.from(new Map(cartItems.map(item => [item.name, item])).values());
    return uniqueCartItems.map(item => (
      <div key={item.id} className="product-cart">
        <img src={item.picture_side} alt={item.name} className="product-img"/>
        <div className="product-line">
          <div>{item.name}</div>
          <b>${item.price} x{item.count}</b>
        </div>
        <span onClick={() => removeFromCart(item.id)}><img src={iconDelete} className='icon-img'/></span>
      </div>
    ));
  };

  return (
    <div id="shop-container">
      <div onClick={toggleSidebar} className="toggle-cart-btn">
        <img src={isSidebarOpen ? iconClose : iconToggleCart} className='icon-img'/>
      </div>

      <div onClick={goBackHome} className="home-btn">        
        <img src={iconHome} className='icon-img'/>
      </div>

      <div className="main-content">
        <div className="shop-class">
          <img src={bannerTop} className='shop-banner'/>

          <h1>NEW ARRIVALS</h1>
          <div className="product-slideshow">
            <div onClick={goToPreviousSlide}><img src={iconLeftArrow} className='icon-img'/></div>
            {products[activeSlideIndex] && (
              <div key={products[activeSlideIndex].id} className="slideshow-item">
                <h2>{products[activeSlideIndex].name}</h2>
                <img src={products[activeSlideIndex].picture} alt={products[activeSlideIndex].name} className='img-slideshow'/>
                
                <div onClick={() => addToCart(products[activeSlideIndex])} className='price-tag'>
                  <span>${products[activeSlideIndex].price} </span>
                  <img src={iconAddCart} className='icon-img'/>
                </div>
              </div>
            )}
            <div onClick={goToNextSlide}><img src={iconRightArrow} className='icon-img'/></div>
          </div>

          <h1>CATALOG</h1>

          <div className='horizontal-list'>
            {products.map(product => (
              <div key={product.id} className="product-item">
                <img src={product.picture_side} alt={product.name} className="product-img" loading="lazy" decoding="async" />
                <h3>{product.name}</h3>
                <div onClick={() => addToCart(product)} className='price-tag'>
                  <span>${product.price} </span>
                  <img src={iconAddCart} className='icon-img'/>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className='about'>
          <h1>ABOUT US</h1>
          <a href="https://www.instagram.com/your_instagram_username" target="_blank"><img src={iconInstagram}/></a>
          <a href="https://www.facebook.com/your_facebook_page" target="_blank"><img src={iconFacebook}/></a>
          <a href="https://wa.me/your_whatsapp_number" target="_blank"><img src={iconWhatsapp}/></a>
        </div>

        <img src={logo} alt="Shop Logo" className="shop-logo"/>  
        
        <div className="bottom-banner">
            <p>&copy; 2024 Kartel. All rights reserved.</p>
        </div>  
      </div>



      {isSidebarOpen && (
        <div className="cart-sidebar">
            <div className="payment-methods">
            {renderCartItems()} 
                <p>Total: 
                    <b>${cartItems.reduce((total, currentItem) => {
                    return total + (currentItem.price * currentItem.count);
                    }, 0).toFixed(2)}
                    </b>
                </p>
                <p>Total Items in Cart: <b>{cartItems.length}</b></p>
                <button onClick={() => handlePaymentMethod('Amex')}>Pay with American Express</button>
                <button onClick={() => handlePaymentMethod('paypal')}>Pay with PayPal</button>
            </div>
        </div>
      )}

      
    </div>
  );
};

export default KartelShop;