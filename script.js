/* RouteNG marketplace prototype
   The UI is intentionally separated from data and API integration so the
   same components can later be connected to a real backend. */

const CONFIG = {
  apiBase: "/api",
  storageKey: "routeng-demo-state",
};

const CITIES = [
  "Abuja","Lagos","Calabar","Abeokuta","Jos","Enugu","Kaduna","Kano","Makurdi","Benin City","Ibadan","Ilorin","Port Harcourt","Zaria","Minna","Lokoja","Lafia","Onitsha","Keffi","Owerri","Uyo","Akure","Warri","Asaba","Ado-Ekiti","Osogbo","Sokoto","Bauchi","Gombe","Yola","Maiduguri"
];

const ROUTES = [
  ["Lagos","Abuja",18000,"10h","assets/hero.webp"],
  ["Abuja","Jos",7000,"3h 30m","assets/nigeria.webp"],
  ["Abuja","Kaduna",5000,"2h 30m","assets/travel.webp"],
  ["Calabar","Enugu",6500,"4h","assets/hero.webp"],
  ["Abeokuta","Lagos",4500,"2h","assets/nigeria.webp"],
  ["Enugu","Port Harcourt",7000,"3h 30m","assets/travel.webp"],
  ["Ibadan","Lagos",5000,"2h 30m","assets/hero.webp"],
  ["Abuja","Kano",11000,"6h","assets/nigeria.webp"],
];

const RIDES = [
  {id:"r1",from:"Lagos",to:"Abuja",time:"07:30",date:"2026-09-19",price:18000,seats:2,driver:"Chinedu Okafor",rating:4.9,reviews:37,verified:true,vehicle:"Toyota Camry",pickup:"Ojota Bus Stop",female:false},
  {id:"r2",from:"Lagos",to:"Abuja",time:"09:00",date:"2026-09-19",price:15000,seats:1,driver:"Aisha Bello",rating:4.8,reviews:21,verified:true,vehicle:"Honda Accord",pickup:"Berger",female:true},
  {id:"r3",from:"Lagos",to:"Abuja",time:"16:00",date:"2026-09-19",price:16500,seats:3,driver:"Daniel Eze",rating:4.7,reviews:18,verified:false,vehicle:"Toyota Corolla",pickup:"Ikeja",female:false},
  {id:"r4",from:"Abuja",to:"Jos",time:"06:45",date:"2026-09-19",price:7000,seats:2,driver:"Musa Ibrahim",rating:4.9,reviews:44,verified:true,vehicle:"Hyundai Elantra",pickup:"Jabi Lake",female:false},
  {id:"r5",from:"Abuja",to:"Kaduna",time:"13:00",date:"2026-09-19",price:5000,seats:3,driver:"Grace Okoro",rating:5.0,reviews:12,verified:true,vehicle:"Kia Rio",pickup:"Gwarinpa",female:true},
  {id:"r6",from:"Enugu",to:"Port Harcourt",time:"08:00",date:"2026-09-19",price:7000,seats:2,driver:"Emeka Nwosu",rating:4.8,reviews:29,verified:true,vehicle:"Toyota Sienna",pickup:"New Haven",female:false},
];

const BUSES = [
  {operator:"GUO Transport",from:"Lagos",to:"Abuja",time:"07:00",duration:"10h 30m",price:22000},
  {operator:"ABC Transport",from:"Abuja",to:"Enugu",time:"06:30",duration:"8h",price:17000},
  {operator:"Peace Mass Transit",from:"Enugu",to:"Port Harcourt",time:"08:00",duration:"4h",price:8500},
];

let state = loadState();
let currentMode = "carpool";
let currentResults = [];

const $ = (id) => document.getElementById(id);
const modalBackdrop = $("modal-backdrop");
const modal = $("modal");
const toast = $("toast");

function loadState(){
  try { return JSON.parse(localStorage.getItem(CONFIG.storageKey)) || {saved:[], bookings:[], rides:[], user:null}; }
  catch { return {saved:[], bookings:[], rides:[], user:null}; }
}
function saveState(){localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));}
function money(n){return `₦${Number(n).toLocaleString("en-NG")}`;}
function initials(name){return name.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase();}
function today(){return new Date().toISOString().slice(0,10);}
function notify(message){toast.textContent=message;toast.classList.add("show");clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.classList.remove("show"),3200);}

function api(path, options={}){
  return fetch(`${CONFIG.apiBase}${path}`,{credentials:"include",headers:{"Content-Type":"application/json",...(options.headers||{})},...options})
    .then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||"Request failed");return data;});
}

function fillCities(){
  const opts=`<option value="">Select city</option>${CITIES.map(c=>`<option>${c}</option>`).join("")}`;
  $("from").innerHTML=opts;$("to").innerHTML=opts;
}

function renderRoutes(){
  $("route-grid").innerHTML=ROUTES.map(([from,to,price,duration,image])=>`<article class="route-card" data-route="${from}|${to}">
    <div class="route-image"><img src="${image}" alt="Travel from ${from} to ${to}"><span class="route-city">${from}</span></div>
    <div class="route-body"><h3>${from} → ${to}</h3><div class="route-meta"><span>${duration}</span><span>from</span></div><div class="route-price">${money(price)} <small>/ passenger</small></div></div>
  </article>`).join("");
}

function renderBuses(){
  $("bus-grid").innerHTML=BUSES.map(b=>`<article class="bus-card">
    <div class="bus-top"><div class="operator"><span class="operator-logo">${initials(b.operator)}</span>${b.operator}</div><span class="driver-rating">★ 4.6</span></div>
    <h3>${b.from} → ${b.to}</h3><div class="bus-meta">${b.time} · ${b.duration}</div><div class="bus-price">${money(b.price)} <small>/ passenger</small></div>
    <button class="primary-button full" data-action="book-bus" data-operator="${b.operator}">View ticket</button>
  </article>`).join("");
}

function applyFilters(list){
  const max=Number($("price-filter").value||Infinity);
  const seats=Number($("seat-filter").value||0);
  const verified=$("verified-filter").checked;
  const female=$("female-filter").checked;
  const time=$("time-filter").value;
  return list.filter(r=>{
    const hour=Number(r.time.slice(0,2));
    const timeOk=!time||(time==="morning"&&hour<12)||(time==="afternoon"&&hour>=12&&hour<17)||(time==="evening"&&hour>=17);
    return r.price<=max&&r.seats>=seats&&(!verified||r.verified)&&(!female||r.female)&&timeOk;
  });
}

function renderRides(list){
  currentResults=list;
  const box=$("ride-list");
  if(!list.length){box.innerHTML=`<div class="empty"><strong>No matching rides.</strong><br>Try another date, route or filter.</div>`;return;}
  box.innerHTML=list.map(r=>`<article class="ride-card">
    <div class="ride-main"><div class="ride-route">${r.from} → ${r.to}</div><div class="ride-time">${r.time} · ${r.pickup} · ${r.seats} seat${r.seats>1?'s':''} left</div>
      <div class="ride-driver"><span class="avatar">${initials(r.driver)}</span><div><strong>${r.driver} ${r.verified?"✓":""}</strong><div class="driver-rating">★ ${r.rating} · ${r.reviews} reviews · ${r.vehicle}</div></div></div>
    </div><div class="ride-price"><strong>${money(r.price)}</strong><span>per passenger</span></div>
    <div class="ride-actions"><button class="primary-button" data-action="book-ride" data-id="${r.id}">View & book</button><button class="small-outline" data-action="save-ride" data-id="${r.id}">${state.saved.includes(r.id)?"Saved":"♡ Save"}</button></div>
  </article>`).join("");
}

function search(){
  const from=$("from").value,to=$("to").value,date=$("date").value;
  let list=RIDES.concat(state.rides||[]);
  if(from) list=list.filter(r=>r.from===from);
  if(to) list=list.filter(r=>r.to===to);
  if(date) list=list.filter(r=>r.date===date || !r.date);
  if(currentMode==="bus") {notify("Bus search is ready for operator/API integration.");return;}
  renderRides(applyFilters(list));
  $("results").hidden=false;
  $("results").scrollIntoView({behavior:"smooth",block:"start"});
}

function openModal(content){modal.innerHTML=content;modalBackdrop.hidden=false;document.body.style.overflow="hidden";}
function closeModal(){modalBackdrop.hidden=true;document.body.style.overflow="";}

function openLogin(){openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="section-label">ACCOUNT</span><h2>Welcome to RouteNG</h2><p>Sign in to book seats, publish rides, save routes and message travel partners.</p><div class="form-field"><label>Email</label><input id="login-email" type="email" placeholder="you@example.com"></div><div class="form-field"><label>Password</label><input id="login-password" type="password" placeholder="••••••••"></div><div class="modal-actions"><button class="primary-button" data-action="login">Log in</button><button class="small-outline" data-action="register">Create account</button></div>`);}

function openOffer(){openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="section-label">DRIVER</span><h2>Publish a ride</h2><p>Tell passengers where you're going and how many seats you can share.</p><form id="offer-form"><div class="form-grid"><div class="form-field"><label>From</label><select id="offer-from" required></select></div><div class="form-field"><label>To</label><select id="offer-to" required></select></div><div class="form-field"><label>Date</label><input id="offer-date" type="date" value="${today()}" required></div><div class="form-field"><label>Departure</label><input id="offer-time" type="time" value="08:00" required></div><div class="form-field"><label>Seats</label><select id="offer-seats"><option>1</option><option>2</option><option>3</option><option>4</option></select></div><div class="form-field"><label>Contribution / passenger</label><input id="offer-price" type="number" min="0" placeholder="15000" required></div></div><div class="form-field"><label>Pickup point</label><input id="offer-pickup" placeholder="e.g. Jabi Lake" required></div><div class="form-field"><label>Vehicle</label><input id="offer-vehicle" placeholder="Toyota Camry" required></div><label class="check-row"><input id="offer-auto" type="checkbox" checked> Automatically accept booking requests</label><div class="modal-actions"><button class="primary-button" type="submit">Publish ride</button><button class="small-outline" type="button" data-action="close-modal">Cancel</button></div></form></div>`);
  const a=$("offer-from"),b=$("offer-to");const opts=`<option value="">Select city</option>${CITIES.map(c=>`<option>${c}</option>`).join("")}`;a.innerHTML=opts;b.innerHTML=opts;
  $("offer-form").addEventListener("submit",e=>{e.preventDefault();publishRide();});
}

function publishRide(){
  const ride={id:`local-${Date.now()}`,from:$("offer-from").value,to:$("offer-to").value,date:$("offer-date").value,time:$("offer-time").value,price:Number($("offer-price").value),seats:Number($("offer-seats").value),driver:state.user?.name||"You",rating:5,reviews:0,verified:Boolean(state.user),vehicle:$("offer-vehicle").value,pickup:$("offer-pickup").value,female:false};
  if(!ride.from||!ride.to||ride.from===ride.to)return notify("Choose two different cities.");
  state.rides.push(ride);saveState();closeModal();notify("Ride published successfully.");
}

function openBooking(id){
  const r=RIDES.concat(state.rides).find(x=>x.id===id);if(!r)return;
  openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="section-label">BOOK YOUR SEAT</span><h2>${r.from} → ${r.to}</h2><p>${r.time} · ${r.pickup} · ${r.vehicle}</p><div class="ride-card"><div class="ride-main"><div class="ride-driver"><span class="avatar">${initials(r.driver)}</span><div><strong>${r.driver} ${r.verified?'✓':''}</strong><div class="driver-rating">★ ${r.rating} · ${r.reviews} reviews</div></div></div></div><div class="ride-price"><strong>${money(r.price)}</strong><span>per passenger</span></div></div><div class="form-field"><label>Seats</label><select id="booking-seats">${Array.from({length:r.seats},(_,i)=>`<option value="${i+1}">${i+1} seat${i?'s':''}</option>`).join("")}</select></div><div class="form-field"><label>Pickup point</label><input id="booking-pickup" value="${r.pickup}"></div><div class="modal-actions"><button class="primary-button" data-action="confirm-book" data-id="${r.id}">Request booking</button><button class="small-outline" data-action="close-modal">Cancel</button></div>`);
}

function confirmBooking(id){
  const r=RIDES.concat(state.rides).find(x=>x.id===id);const seats=Number($("booking-seats").value||1);if(!r)return;
  state.bookings.push({id:`b-${Date.now()}`,rideId:id,seats,status:"PENDING",route:`${r.from} → ${r.to}`,price:r.price*seats});saveState();closeModal();notify("Booking request sent. Check My trips for updates.");
}

function openAccount(){
  const user=state.user;
  openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="section-label">MY ROUTENG</span><h2>${user?`Hi, ${user.name}`:"Your travel account"}</h2><p>${user?"Manage your bookings, saved rides and published journeys.":"Log in to access your trips, messages, saved routes and driver dashboard."}</p>
    ${user?`<div class="feature-card"><strong>${state.bookings.length}</strong><p>Booking(s)</p></div><div class="feature-card"><strong>${state.rides.length}</strong><p>Published ride(s)</p></div><div class="modal-actions"><button class="primary-button" data-action="show-bookings">My trips</button><button class="small-outline" data-action="logout">Log out</button></div>`:`<div class="modal-actions"><button class="primary-button" data-action="open-login">Log in</button><button class="small-outline" data-action="register">Create account</button></div>`}`);
}

function register(){
  openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="section-label">CREATE ACCOUNT</span><h2>Join RouteNG</h2><div class="form-field"><label>Full name</label><input id="reg-name" placeholder="Your full name"></div><div class="form-field"><label>Email</label><input id="reg-email" type="email" placeholder="you@example.com"></div><div class="form-field"><label>Phone</label><input id="reg-phone" placeholder="080…"></div><div class="modal-actions"><button class="primary-button" data-action="create-account">Create account</button><button class="small-outline" data-action="close-modal">Cancel</button></div>`);
}

function createAccount(){const name=$("reg-name").value.trim();const email=$("reg-email").value.trim();if(!name||!email)return notify("Enter your name and email.");state.user={name,email};saveState();closeModal();notify("Account created. Welcome to RouteNG!");}
function login(){const email=$("login-email").value.trim();if(!email)return notify("Enter your email.");state.user={name:email.split("@")[0].replace(/[._-]/g," ").replace(/\b\w/g,x=>x.toUpperCase()),email};saveState();closeModal();notify("You're logged in.");}
function showBookings(){const html=state.bookings.length?state.bookings.map(b=>`<div class="feature-card"><strong>${b.route}</strong><p>${b.seats} seat(s) · ${money(b.price)} · ${b.status}</p></div>`).join(""):"<div class='empty'>No trips yet.</div>";openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="section-label">MY TRIPS</span><h2>Your bookings</h2>${html}`);}

function handleAction(el){
  const action=el.dataset.action;
  if(action==="open-login")openLogin();
  if(action==="open-offer")openOffer();
  if(action==="open-account")openAccount();
  if(action==="close-modal")closeModal();
  if(action==="login")login();
  if(action==="register")register();
  if(action==="create-account")createAccount();
  if(action==="logout"){state.user=null;saveState();closeModal();notify("Logged out.");}
  if(action==="show-bookings")showBookings();
  if(action==="book-ride")openBooking(el.dataset.id);
  if(action==="confirm-book")confirmBooking(el.dataset.id);
  if(action==="save-ride"){const id=el.dataset.id;state.saved=state.saved.includes(id)?state.saved.filter(x=>x!==id):[...state.saved,id];saveState();search();}
  if(action==="swap"){[$("from").value,$("to").value]=[$("to").value,$("from").value];}
  if(action==="open-search")document.querySelector(".search-card").scrollIntoView({behavior:"smooth"});
  if(action==="open-filters")$("filter-panel").classList.add("open");
  if(action==="close-filters")$("filter-panel").classList.remove("open");
  if(action==="apply-filters")search();
  if(action==="show-all-routes")renderRoutes();
  if(action==="book-bus")notify(`Bus ticket flow for ${el.dataset.operator} is ready for operator API integration.`);
}

document.addEventListener("click",e=>{
  const action=e.target.closest("[data-action]");if(action){e.preventDefault();handleAction(action);return;}
  const route=e.target.closest("[data-route]");if(route){const [from,to]=route.dataset.route.split("|");$("from").value=from;$("to").value=to;search();return;}
  const tab=e.target.closest(".search-tab");if(tab){document.querySelectorAll(".search-tab").forEach(x=>x.classList.remove("active"));tab.classList.add("active");currentMode=tab.dataset.mode;}
  const card=e.target.closest(".route-card");if(card){const [from,to]=card.dataset.route.split("|");$("from").value=from;$("to").value=to;search();}
});

$("search-form").addEventListener("submit",e=>{e.preventDefault();search();});
modalBackdrop.addEventListener("click",e=>{if(e.target===modalBackdrop)closeModal();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});

function init(){
  fillCities();renderRoutes();renderBuses();$("date").value=today();
  if(state.user)document.querySelector("[data-action=\"open-account\"]").title=state.user.name;
}
init();
