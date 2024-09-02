import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import '../../styles/KartelShop.css';
import bannerTop from '../../res/banner.png';
import logo from '../../res/Logo.png';
import item1 from '../../res/item1.png';
import item2 from '../../res/item3.png';
import item3 from '../../res/item5.png';
import item1side from '../../res/item2.png';
import item2side from '../../res/item4.png';
import item3side from '../../res/item6.png';
import iconToggleCart from '../../res/shopping-cart.png';
import iconLeftArrow from '../../res/left-arrow.png';
import iconRightArrow from '../../res/right-arrow.png'; // Changed to FontAwesome icon
import iconAddCart from '../../res/add-cart.png';
import iconDelete from '../../res/trash-can.png';
import iconInstagram from '../../res/instagram.png';
import iconFacebook from '../../res/facebook.png';
import iconWhatsapp from '../../res/whatsapp.png';
import iconClose from '../../res/close.png';
import iconHome from '../../res/home.png';


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
                <img src={product.picture_side} alt={product.name} className="product-img" /> {/* Added line */}
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