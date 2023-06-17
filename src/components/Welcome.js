//import { render } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { useNavigate  } from 'react-router-dom';
import './styles/Welcome.css'

const CreateParticlesAndRun = () => {
    
    const canvas = document.getElementById('IntroParticleCanvas')
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    let particleArray = [];
    const adjustX = 0;
    const adjustY = 0;

    class Particle{
        constructor(x, y){
            this.x = x;
            this.y = y;
            // this.size = Math.random() * 5;
            this.size = 2.5; //4
            this.baseX = this.x;
            this.baseY = this.y;
            this.density = (Math.random() * 100) + 1;//move speed
        }
    
        draw(){
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fill();
        }
    
        update(){
            let dx = mouse.x - this.x;
            let dy = mouse.y - this.y;
            let distance = Math.sqrt(dx * dx + dy * dy)
            let forceDirectionX = dx / distance;
            let forceDirectionY = dy / distance;
            let maxDistance = mouse.radius;
            let force = (maxDistance - distance) / maxDistance;
            let directionX = forceDirectionX * force * this.density;
            let directionY = forceDirectionY * force * this.density;
    
            if (distance < mouse.radius){
                this.x -= directionX;
                this.y -= directionY;
            } else {
                if (this.x !== this.baseX){
                    let dx = this.x - this.baseX;
                    this.x -= dx / 25; //velocity of rearrange
                };
                if (this.y !== this.baseY){
                    let dy = this.y - this.baseY;
                    this.y -= dy / 25; //velocity of rearrange
                };
            }
        }
    }

    function init(){
        //console.log(textCoordinates);
        let particle_space = 1;
        let step;
        if(sizeRatio < 8)
            step = 5;
        else
            step = 10;
        particleArray = [];
        /*
        let total_particles = (window.innerHeight * window.innerWidth) / 50;
        for(let i = 0; i < total_particles; i++){
            let x = Math.random () * canvas.width;
            let y = Math.random () * canvas.height;
            particleArray.push(new Particle(x, y));
        }*/
        
        let particleIndex= 0;
        for (let y = 0, y2 = textCoordinates.height ; y < y2; y += step){
            for(let x = 0, x2 = textCoordinates.width; x < x2; x += step){
                /*No math needed, at all. Just declare a variable before the outer for 
                loop and increment by 4 on every inner loop at the end. Just add 3 to 
                the current value for the index.*/
                let alphaIndex = (y * 4 * textCoordinates.width) + (x * 4) + 3;

                if(textCoordinates.data[alphaIndex] > 20){
                    let xi = Math.random () * canvas.width;
                    let yi = Math.random () * canvas.height;
                    particleArray.push(new Particle(xi, yi));

                    let positionX = (x + adjustX) * particle_space;
                    let positionY = (y + adjustY) * particle_space;
                    /*particleArray.push(new Particle(positionX, positionY));*/
                    if(particleIndex < particleArray.length){
                        particleArray[particleIndex].baseX = positionX;
                        particleArray[particleIndex].baseY = positionY;
                        //console.log(particleIndex)
                        ++particleIndex;
                    }
                }
            }
        }
    //console.log(particleArray)
    }
    
    const connect = ()=>{
        const step = 5;
        let opacityValue = 1;
        let pLen = particleArray.length;
        for (let a = 0; a < pLen; a += step){
            for (let b = a; b < pLen; b += step){
                let dx = particleArray[a].x - particleArray[b].x;
                let dy =  particleArray[a].y - particleArray[b].y;
                let distanceNeighboor = Math.sqrt(dx * dx + dy * dy);
                let dBx = particleArray[a].x - particleArray[a].baseX;
                let dBy =  particleArray[a].y - particleArray[a].baseY;
                let distanceToBase = Math.sqrt(dBx * dBx + dBy * dBy);
                opacityValue = 0 + ( distanceToBase / 50);
                let condition1 = (distanceNeighboor > 15 && distanceNeighboor < 50) 
                // let condition2 = ( 
                //     particleArray[a].x > (particleArray[a].baseX + 20) && 
                //     particleArray[a].y > (particleArray[a].baseY + 20)
                // )
                if (condition1){
                    ctx.strokeStyle = `rgba(255, 255, 255, ${opacityValue})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(particleArray[a].x, particleArray[a].y);
                    ctx.lineTo(particleArray[b].x, particleArray[b].y);
                    ctx.stroke();
                }
            }
        }
    }

    function animate(){
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < particleArray.length; i++){
            particleArray[i].draw();
            particleArray[i].update();
        }
        connect();
        requestAnimationFrame(animate);
    }
    
    const mouse = {
        x: null,
        y: null,
        radius: 35
    }
    
    window.addEventListener('mousemove', function(event){
        mouse.x = event.x;
        mouse.y = event.y;
        //console.log(mouse.x,mouse.y)
    })
    
    //Begin
    ctx.fillStyle = 'white';            
    let ch = window.innerHeight / 2;
    let valuetop = "25vw"
    let valuebot = "13.25vw"
    let titleVspace;
    let sizeRatio = (window.innerWidth * window.innerHeight) / 100000;
    console.log(sizeRatio);
    if (window.innerHeight >  window.innerWidth){
        titleVspace = 9;
    }else{ 
        titleVspace = 5;
    }
    ctx.font = `${valuetop} Varela Round`;
    ctx.fillText('REIMON', 5, ch - ch/titleVspace);
    ctx.font = `${valuebot} Varela Round`;
    ctx.fillText('DEVELOPMENT', 5, ch + ch/titleVspace);
    
    // ctx.strokeStyle = 'white';
    // ctx.strokeRect(0, 0, 10, 10);
    
    const textCoordinates = ctx.getImageData(0, 0, canvas.width, canvas.height);

    init();
    animate();
};

const Welcome = () =>{

    const navigate = useNavigate();

    const [outro, setOutro] = useState(false);
    const [enterSite, setEnterSite] = useState(false);

    useEffect( () => { 
        CreateParticlesAndRun();
        if (!outro) setTimeout(()=>{
            setOutro(true);
        }, 1000)
        // eslint-disable-next-line
    }, []);

    const getBackgroundStyle = () => {
        if (!outro && !enterSite)
            return "intro-background";
        else if (enterSite)
            return "entersite-background";
        else if (outro)
            return "outro-background";
    }

    const onIntroFinished = () => {
        setEnterSite(true);
        setTimeout(()=>{
            navigate('/home', { replace: true });
        }, 2000);
    }

    return(
        <div id="WelcomeComponentBody" className={getBackgroundStyle()}>
            {/* Enter button container*/}
            <div className="bottom-container">
                <div className="skip" onClick={() => onIntroFinished()}>
                    <a href={null}>
                        Enter
                        <span className="shift">›</span>
                    </a>
                    <div className="mask"></div>
                </div>
            </div>
            {/* Particle intro canvas */}
            <canvas id="IntroParticleCanvas">
            </canvas>
        </div>
    )
    
}
export default Welcome;